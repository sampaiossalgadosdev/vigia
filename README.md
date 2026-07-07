# VIGIA — Varejo Inteligente: Gestão Integrada e Automatizada

SaaS multi-tenant de gestão para pequenos e médios supermercados. **Parte 1**: retaguarda (produtos, fornecedores, estoque via NF-e, usuários), painel do superadmin (dono do SaaS) e painel de rede (superusuário com várias lojas).

---

## 1. Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 18+ · Express |
| Banco | PostgreSQL 14+ · Prisma ORM |
| Auth | JWT (access 8h em memória + refresh 30d rotacionado com hash bcrypt) |
| Frontend | HTML + CSS + JavaScript puro (sem framework) |
| Gráficos | Chart.js via CDN (painel de rede) |
| Uploads | Multer em memória (XML NF-e, CSV/XLSX) |
| Logs | Winston (console em dev, arquivo JSON em produção) |

## 2. Pré-requisitos

- Node.js 18 ou superior
- PostgreSQL 14 ou superior rodando localmente (ou uma `DATABASE_URL` de nuvem)

## 3. Instalação local

```bash
# 1. Instale as dependências
npm install

# 2. Configure o ambiente
cp .env.example .env
# edite o .env com a sua DATABASE_URL e segredos JWT

# 3. Crie as tabelas
npx prisma migrate dev --name init

# 4. Popule com dados de exemplo
npx prisma db seed

# 5. Rode em desenvolvimento
npm run dev
```

Acesse:

| Painel | URL |
|---|---|
| Retaguarda do mercado | http://localhost:3000 (redireciona para /login.html) |
| Superadmin (dono do SaaS) | http://localhost:3000/superadmin.html |
| Painel da rede (superusuário) | http://localhost:3000/rede/login.html |

## 4. Credenciais do seed

| Contexto | E-mail | Senha |
|---|---|---|
| Superadmin | admin@sistema.com | Admin@123 |
| Superusuário (rede) | rede@exemplo.com | Rede@123 |
| Dono — Supermercado Silva | dono@silva.com.br | Senha@123 |
| Gerente — Silva | gerente@silva.com.br | Senha@123 |
| Operador — Silva | operador@silva.com.br | Senha@123 |
| Dono — Supermercado Costa | dono@costa.com.br | Senha@123 |
| Gerente — Costa | gerente@costa.com.br | Senha@123 |
| Operador — Costa | operador@costa.com.br | Senha@123 |

O seed cria 2 tenants, 15 produtos por tenant (3 vendidos por peso com PLU), 2 fornecedores e 3 categorias por tenant, movimentações de estoque recentes e 1 sugestão por tenant.

## 5. Variáveis de ambiente (.env)

| Variável | Descrição | Exemplo |
|---|---|---|
| `DATABASE_URL` | Conexão PostgreSQL | `postgresql://user:pass@localhost:5432/vigia` |
| `JWT_SECRET` | Segredo do access token (tenant) | string longa aleatória |
| `JWT_REFRESH_SECRET` | Segredo do refresh token | string longa aleatória diferente |
| `JWT_ADMIN_SECRET` | Segredo do token do superadmin | string longa aleatória diferente |
| `JWT_REDE_SECRET` | Segredo do token do superusuário | string longa aleatória diferente |
| `PORT` | Porta do servidor | `3000` |
| `NODE_ENV` | `development` ou `production` | `development` |
| `CORS_ORIGIN` | Origem permitida (`*` em dev) | `https://app.seudominio.com.br` |

Gere segredos com: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## 6. Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe com `node --watch` (reinicia ao salvar) |
| `npm start` | Sobe em modo produção |
| `npm run seed` | Popula o banco (idempotente por upsert de CNPJ/e-mail) |
| `npx prisma migrate dev` | Cria/aplica migrations em dev |
| `npx prisma migrate deploy` | Aplica migrations em produção |
| `npx prisma studio` | Interface visual do banco |

## 7. Estrutura de pastas

```
vigia/
├── prisma/
│   ├── schema.prisma        # Modelos do banco
│   └── seed.js              # Dados de exemplo
├── src/
│   ├── config/              # app.js, auth.js, database.js (Prisma singleton)
│   ├── logs/                # logger.js (winston)
│   ├── middlewares/         # auth, authAdmin, authRede, role, upload
│   ├── validators/          # express-validator por módulo
│   ├── controllers/         # Recebem req/res, nunca tocam o Prisma
│   ├── services/            # Toda a regra de negócio
│   ├── repositories/        # Único lugar com acesso ao Prisma
│   ├── utils/               # response, jwt, bcrypt, cnpj, cpf, nfe.parser, planilha
│   ├── routes/              # Definição dos endpoints
│   └── server.js            # Entrada da aplicação
└── public/                  # Frontend estático
    ├── css/                 # app.css (tenant/admin) e rede.css
    ├── js/                  # api.js, auth.js, api-rede.js, auth-rede.js
    ├── *.html               # login, index, produtos, fornecedores, estoque, usuarios, superadmin
    └── rede/                # login, index (cards), loja (métricas), comparativo
```

## 8. Fluxo de uma requisição

```
Request → Route → Middleware (auth/role/upload/validator) → Controller → Service → Repository → Prisma → Response
```

Resposta padrão de sucesso: `{ "success": true, "data": {...} }`
Resposta padrão de erro: `{ "success": false, "message": "...", "errors": [] }`

## 9. Regras de negócio principais

- **Multi-tenant**: o `tenantId` vem SEMPRE do JWT, nunca do body/query. Toda query filtra por ele.
- **NF-e**: upload do XML → parse → itens casados por EAN → confirmação em transação atualiza estoque e **custo médio ponderado**. Itens sem EAN correspondente ficam `pendente` e a confirmação parcial é permitida; depois é possível vincular a um produto (aplica a entrada retroativamente se a nota já estava confirmada).
- **Importação em lote**: 2 etapas (preview → confirmar com token de 10 min), até 5.000 linhas / 10MB, validação linha a linha com o mesmo rigor do cadastro individual.
- **Produtos por peso**: `vendidoPorPeso=true` exige PLU de 4 a 6 dígitos (código da balança).
- **Soft delete**: produtos, fornecedores e usuários são desativados (`ativo=false`), nunca apagados.
- **Auditoria**: criar/editar/excluir/alterar preço/confirmar NF-e/importar geram registro em `Auditoria` com antes/depois.
- **Tenant suspenso**: `ativo=false` bloqueia login e toda a API do tenant com HTTP 403.

## 10. Deploy no Railway (passo a passo)

1. Crie conta em https://railway.app e instale o CLI (`npm i -g @railway/cli`) ou use o dashboard.
2. **New Project → Deploy from GitHub repo** (suba este projeto para um repositório antes).
3. No projeto Railway, clique **+ New → Database → PostgreSQL**. O Railway cria a variável `DATABASE_URL` automaticamente no serviço do banco.
4. No serviço da aplicação, vá em **Variables** e adicione:
   - `DATABASE_URL` → use a *reference* `${{Postgres.DATABASE_URL}}`
   - `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ADMIN_SECRET`, `JWT_REDE_SECRET` → strings aleatórias longas
   - `NODE_ENV=production`
   - `CORS_ORIGIN` → domínio do app (ou `*` enquanto testa)
5. Em **Settings → Deploy**, configure:
   - Build command: `npm install && npx prisma generate`
   - Start command: `npx prisma migrate deploy && node src/server.js`
6. Faça o primeiro deploy. Depois rode o seed uma única vez pelo shell do Railway: `npx prisma db seed`.
7. Em **Settings → Networking → Generate Domain** para obter a URL pública.

> Alternativa recomendada a médio prazo: Fly.io (região São Paulo `gru`), que você já usa em outros projetos — o processo é análogo (secrets + `migrate deploy` no release command).

## 11. Endpoints principais

Autenticação tenant: `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`
Produtos: `GET/POST /api/produtos`, `GET/PUT/DELETE /api/produtos/:id`, `GET /api/produtos/exportar/modelo`, `POST /api/produtos/importar/preview`, `POST /api/produtos/importar/confirmar`, `GET /api/produtos/sync`, `GET /api/produtos/estoque/alertas`
Fornecedores: CRUD em `/api/fornecedores`
Estoque: `POST /api/estoque/nfe/upload`, `POST /api/estoque/nfe/confirmar/:nfeId`, `GET /api/estoque/nfe`, `GET /api/estoque/nfe/:id`, `POST /api/estoque/nfe/:nfeId/itens/:itemId/vincular`, `GET /api/estoque/movimentacoes`, `GET /api/estoque/pendentes`
Usuários: CRUD em `/api/usuarios` (listar: dono/gerente; escrever: só dono)
Sugestões (tenant): `GET /api/sugestoes`, `PUT /api/sugestoes/:id/lida`, `PUT /api/sugestoes/:id/arquivada`
Superadmin: `POST /api/superadmin/login` + gestão de `/tenants` e `/superusuarios`
Rede: `POST /api/rede/login`, `GET /api/rede/lojas`, `GET /api/rede/lojas/:tenantId`, `GET /api/rede/comparativo?mes=YYYY-MM`, `POST/GET /api/rede/sugestoes`

Paginação em todas as listagens: `?page=1&limit=20&order=asc|desc&search=termo`.

## 12. Observação da Parte 1 (sem PDV)

Como as vendas do PDV chegam apenas na Parte 2, as métricas de "faturamento" do painel de rede são **estimadas**: somatório das movimentações de `saida` × preço atual do produto. Quando o PDV entrar, essas consultas passarão a usar a tabela de vendas real (o ponto de troca está isolado em `src/repositories/rede.repository.js`).

## 13. Roadmap

- **Parte 2**: PDV desktop (Electron + React + SQLite offline-first), sincronização de produtos via `GET /api/produtos/sync`, vendas, NFC-e.
- **Parte 3**: financeiro (contas a pagar/receber), relatórios avançados, camada de sugestões com IA.
