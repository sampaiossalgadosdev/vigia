# Arquitetura do VIGIA — Parte 1

## 1. Visão geral

```
┌─────────────────────────────────────────────────────────────────┐
│                          NAVEGADOR                              │
│                                                                 │
│  Retaguarda (tenant)      Superadmin           Painel de Rede   │
│  login/index/produtos/    superadmin.html      rede/login       │
│  fornecedores/estoque/    (login inline,       rede/index       │
│  usuarios                 admin_token 4h)      rede/loja        │
│  (access em memória +                          rede/comparativo │
│   refresh_token 30d)                           (rede_token 8h)  │
└──────────────┬──────────────────┬──────────────────┬────────────┘
               │ Bearer JWT       │ Bearer JWT       │ Bearer JWT
               ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EXPRESS (src/server.js)                     │
│                                                                 │
│  Route → Middleware → Controller → Service → Repository → Prisma│
│           (auth/role/                                            │
│            upload/valid.)                                        │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼
                        ┌─────────────┐
                        │ PostgreSQL  │
                        └─────────────┘
```

## 2. Camadas e responsabilidades

| Camada | Pasta | Pode | Não pode |
|---|---|---|---|
| Route | `src/routes` | Definir endpoint e encadear middlewares/controller | Lógica de negócio |
| Middleware | `src/middlewares` | Autenticar, autorizar por perfil, receber upload | Regra de negócio |
| Validator | `src/validators` | Validar formato do body (express-validator) | Consultar banco |
| Controller | `src/controllers` | Ler req, chamar service, responder com `success()` | Tocar o Prisma |
| Service | `src/services` | Toda a regra de negócio, orquestrar repositórios e transações | Conhecer req/res |
| Repository | `src/repositories` | Único lugar com `prisma.*` | Regra de negócio |
| Utils | `src/utils` | Funções puras (jwt, bcrypt, cnpj, parser NF-e, planilha, response) | Estado global de negócio |

## 3. Multi-tenant

- Cada tabela de dados do mercado possui `tenantId`.
- O `tenantId` **nunca** vem do cliente: é extraído do JWT no middleware `auth` e injetado em `req.tenantId`.
- Todos os repositórios de tenant recebem `tenantId` como primeiro parâmetro e filtram por ele.
- Unicidade composta: `@@unique([tenantId, ean])` em Produto, `@@unique([tenantId, email])` em Usuario, etc. O mesmo EAN pode existir em tenants distintos.
- Tenant com `ativo=false`: login e todas as rotas retornam 403 "Conta suspensa. Entre em contato com o suporte."

## 4. Contextos de autenticação

| Contexto | Login | Token | Armazenamento no front | Middleware |
|---|---|---|---|---|
| Tenant (dono/gerente/operador) | `/api/auth/login` | access 8h + refresh 30d rotacionado | access em memória JS, refresh em localStorage | `auth` + `role([...])` |
| Superadmin | `/api/superadmin/login` | access 4h (sem refresh) | `admin_token` em localStorage | `authAdmin` |
| Superusuário (rede) | `/api/rede/login` | access 8h (sem refresh) | `rede_token` em localStorage | `authRede` (injeta `tenantIds` atrelados) |
| PDV | — | — | — | Parte 2 |

Refresh token: JWT com `jti`; no banco fica `RefreshToken.id = jti` e `token = bcrypt(refreshToken)`. No refresh, o token antigo é revogado e um novo par é emitido (rotação). Logout revoga o refresh atual.

Cada contexto usa um segredo JWT diferente (`JWT_SECRET`, `JWT_ADMIN_SECRET`, `JWT_REDE_SECRET`), então um token de um contexto nunca é aceito em outro.

## 5. Fluxo da NF-e (entrada de estoque)

```
XML → parse (fast-xml-parser)
    → fornecedor casado por CNPJ (auto-criado se novo)
    → itens casados por EAN dentro do tenant
        ├── com produto → status "ok"
        └── sem produto → status "pendente"
    → NF-e salva como "pendente" (nada muda no estoque ainda)

Confirmar → $transaction:
    para cada item "ok":
        novoCusto = (estoqueAtual × custoAtual + qtd × valorUnit) / (estoqueAtual + qtd)
        estoque += qtd
        cria MovimentacaoEstoque (tipo=entrada, origem=nfe)
    NF-e vira "confirmada"
    (itens pendentes são ignorados — confirmação parcial permitida)

Vincular item pendente depois → se a NF-e já está confirmada,
    a entrada daquele item é aplicada na mesma transação da vinculação.
```

## 6. Importação em lote (2 etapas)

1. **Preview** (`POST /importar/preview`): lê CSV/XLSX (até 5.000 linhas/10MB), valida cada linha (mesmas regras do cadastro individual + duplicidade no arquivo + duplicidade no banco), devolve a lista com status por linha e um `tokenImportacao` guardado em memória com TTL de 10 minutos. Nada é salvo.
2. **Confirmar** (`POST /importar/confirmar`): valida o token, resolve/cria categorias por nome e insere tudo em uma única `$transaction` com `createMany({ skipDuplicates: true })`.

O superadmin tem o mesmo fluxo por tenant em `/api/superadmin/tenants/:id/produtos/importar/*`.

## 7. Métricas do painel de rede (Parte 1)

Sem PDV ainda, não existe tabela de vendas. As métricas usam `MovimentacaoEstoque` com `tipo='saida'` multiplicada pelo preço atual do produto (queries agregadas em SQL puro via `prisma.$queryRaw` em `rede.repository.js`). Isso está documentado na UI ("faturamento estimado"). Na Parte 2, basta trocar as queries desse repositório para a tabela de vendas — services, controllers e frontend permanecem iguais.

## 8. Erros e logs

- `AppError(mensagem, status, errors)` para erros de negócio; o error handler central formata `{ success:false, message, errors }`.
- Validators devolvem 422 com a lista de campos.
- Winston loga toda requisição (info) e toda resposta ≥ 400 (warn) com método, rota, status, duração e usuário. Em produção, grava JSON em `src/logs/app.log`.
- Auditoria de negócio é separada dos logs: tabela `Auditoria` com ação, entidade, antes/depois e IP.

## 9. Decisões e trade-offs registrados

- **Token de importação em memória (Map)**: simples e suficiente para 1 instância; se escalar horizontalmente, mover para Redis (comentado no service).
- **Login por e-mail em múltiplos tenants**: o mesmo e-mail pode existir em tenants diferentes; o login testa a senha contra cada usuário ativo com aquele e-mail e entra no tenant correspondente.
- **XML original guardado** na coluna `xmlOriginal` (auditoria fiscal e reprocessamento futuro).
- **Decimal do Prisma** para todo valor monetário e quantidade de estoque (nunca Float).
- **Frontend sem framework**: páginas HTML independentes com dois wrappers (`API` tenant e `ApiRede`), montagem de sidebar via JS e escape manual de HTML em toda renderização de dados.

## 10. Convenção das páginas do tenant (SPA sem framework)

A retaguarda do tenant (`index.html` até `perfis.html`) navega sem recarregar a página: `Auth.carregarPagina()` (`public/js/auth.js`) busca o HTML da página de destino, troca só o `<main class="conteudo">`, reproduz elementos que ficam fora dele (modais) e reexecuta o `<script>` inline da página. Isso impõe regras que **toda página nova precisa seguir**:

1. **Script da página sempre inline, sem `src`, envolto numa IIFE**: `<script>(() => { ... })();</script>`. Sem IIFE, um `let`/`const` no topo do arquivo quebra com "Identifier já foi declarado" ao revisitar a mesma página na mesma sessão. `navbar.js`/`api.js`/`auth.js` continuam como `<script src="...">` de propósito — são carregados uma vez só e nunca reinjetados (ver `carregarPagina`).
2. **Capturar toda referência de DOM usada por uma função `async` antes do primeiro `await`**, num bloco `const $ = (id) => document.getElementById(id);` no topo da IIFE. Se o usuário navegar para outra página enquanto um `fetch` está pendente, buscar o elemento só depois do `await` retorna `null`. Elemento capturado antes continua sendo um objeto válido: escrever nele depois de "órfão" vira no-op, não exceção.
3. **Modais (e qualquer markup fora de `<main class="conteudo">`) são clonados à parte** pelo loader — não dependem de estarem dentro do `<main>`, mas precisam ser filhos diretos do `<body>` na página de origem.
4. **Nada de `onclick="..."` inline.** Botões estáticos usam `id` + `addEventListener`; linhas geradas dinamicamente (tabelas) usam delegação de evento no container pai com `data-acao`/`data-id`, lidas num único listener.
5. **Objetos de linha não vão para o HTML.** Em vez de `onclick='editar(${JSON.stringify(obj)})'`, guarda-se um `Map<id, objeto>` em memória e o handler delegado busca por `data-id` (ver `estoque.html` e `usuarios.html`).
6. **Padrões de modal/erro/exclusão usam os helpers de `UI`** (`public/js/auth.js`), em vez de repetir o código em cada página:
   - `UI.limparErro(el)` / `UI.erro(el, mensagemOuErro)` — mensagemOuErro aceita string ou o erro lançado por `api.js` (usa `.message` + `.errors`, quando houver).
   - `UI.confirmarAcao(mensagem, acaoAsync)` — `confirm()` + try/catch com `alert(e.message)`, usado nos botões "Excluir/Desativar".
   - `UI.abrirModal(id)` / `UI.fecharModal(id)`, `UI.escapar(texto)`, `UI.moeda`/`UI.numero`/`UI.data` para formatação.

`public/superadmin.html` e `public/rede/*` ficam fora dessas regras de propósito: são apps com reload completo de página, não passam pelo `carregarPagina`.
