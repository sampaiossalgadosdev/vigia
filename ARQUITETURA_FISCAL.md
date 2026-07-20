# Arquitetura Fiscal do VIGIA

Documento único sobre tudo que o sistema faz relacionado a fiscal: emissão de NFC-e (Reforma Tributária 2026), cálculo de IBS/CBS, contingência offline, cancelamento, certificado digital, e o módulo separado de NF-e de entrada. Escrito lendo o código atual, arquivo por arquivo — cada afirmação aqui tem o arquivo (e, quando ajuda, a função) de onde veio, para você poder conferir. Onde o próprio código sinaliza incerteza (jurídica, contábil, ou técnica), reproduzo essa incerteza aqui também, em vez de dar uma certeza que não existe.

**Não sou advogado nem contador.** Tudo que envolve interpretação de lei ou norma contábil está marcado explicitamente como tal, com a fonte usada — nenhuma dessas leituras deve ser tratada como definitiva sem confirmação profissional.

---

## 1. Contexto e prazo

O sistema está no meio da adaptação à Reforma Tributária do Consumo (LC 214/2025, EC 132/2023), que substitui gradualmente ICMS/ISS/PIS/COFINS por IBS (estadual/municipal) e CBS (federal). Para 2026, a lei define uma **alíquota-teste** reduzida — o valor de imposto ainda não é o real, mas o **destaque em nota** (mostrar IBS/CBS separadamente no documento fiscal) já é obrigatório em datas específicas por regime.

O código referencia repetidamente a data **03/08/2026** como prazo para obrigatoriedade do grupo IBS/CBS na NFC-e para tenants com CRT 3 (Lucro Presumido/Real) — regra técnica UB12-10 da Nota Técnica 2025.002-RTC (Portal Nacional da NF-e). Essa é a norma técnica que rege literalmente todo o layout do XML descrito neste documento.

---

## 2. Visão geral — os três aplicativos

```
┌────────────────────────┐        ┌──────────────────────────┐
│   vigia (backend)       │        │  vigia-pdv (Electron)     │
│   Express + PostgreSQL  │◄──────►│  Frente de caixa           │
│   Emissão real de NFC-e │  HTTP  │  Snapshot local (SQLite)   │
│   Fila assíncrona       │        │  Gera XML de contingência  │
└───────────┬─────────────┘        └─────────────┬──────────────┘
            │                                     │ HTTP (LAN da loja)
            │ HTTP (upload/config,                ▼
            │  só pelo Super Admin)   ┌──────────────────────────────┐
            └─────────────────────────►  vigia-pdv-assinatura         │
                                       │  Guarda o certificado A1      │
                                       │  Assina XML de contingência   │
                                       │  Servidor HTTP local (LAN)    │
                                       └────────────────────────────────┘
```

- **vigia** (esta pasta): retaguarda multi-tenant. É quem, no fluxo normal (loja online), monta e transmite a NFC-e real à SEFAZ.
- **vigia-pdv**: o caixa (Electron). No fluxo normal só manda a venda pro backend. Quando o backend está inacessível, ele mesmo monta o XML da NFC-e (modo contingência) e pede pro app abaixo assinar.
- **vigia-pdv-assinatura** ("app ASSINATURA"): roda na máquina do gerente, na mesma rede da loja. É o único lugar, fora do backend, que tem acesso ao certificado digital A1 — existe só para poder assinar XML mesmo com o backend fora do ar.

O certificado digital em si **nunca sai do backend nem do app ASSINATURA** — o vigia-pdv nunca o vê.

---

## 3. Modelo de dados

### 3.1 `Tenant` — configuração fiscal (`prisma/schema.prisma`, model `Tenant`)

| Campo | Para quê |
|---|---|
| `certificadoPfx` (Bytes), `certificadoSenha` | Certificado A1 (.pfx) e senha, **criptografados** (`src/utils/certcrypto.js`, AES-256-GCM, chave em `CERT_ENCRYPTION_KEY`). Mesmo certificado usado tanto para NF-e de entrada (Distribuição DF-e) quanto para emissão de NFC-e — uma empresa tem um único A1 por CNPJ. |
| `certificadoUploadEm`, `certificadoValidade` | Data do upload e data de expiração (extraída do próprio certificado no upload, ver `src/utils/certificadoInfo.js`). |
| `cscProducao`, `cscProducaoId`, `cscHomologacao`, `cscHomologacaoId` | Código de Segurança do Contribuinte — usado só para montar a URL do QR Code (não é o certificado). Também criptografados. |
| `ambienteFiscal` | `homologacao` \| `producao`. Decide qual CSC/URL usar em cada chamada. |
| `regimeTributario` | `simples` \| `presumido` \| `real` — decide o CRT da nota e se o tenant está dispensado do destaque de IBS/CBS em 2026 (ver §4). |
| `uf`, `logradouro`, `numero`, `complemento`, `bairro`, `municipio`, `codigoMunicipioIbge`, `cep`, `inscricaoEstadual`, `cnae` | Grupo `enderEmit`/`emit` do XML — sem eles a SEFAZ recusa a nota, mesmo em homologação. |
| `ultimoNumeroNfce` | Contador sequencial real da série 1 (emissão online), incrementado atomicamente dentro de transação (`nfceEmissao.service.reservarNumeroNfce`). |
| `chaveAssinaturaLocal` | Segredo de pareamento LAN entre o vigia-pdv e o app ASSINATURA (não é dado fiscal — não vai em XML nenhum). Ver §6.1. |
| `ultimoNsu` | Cursor da Distribuição DF-e (NF-e de **entrada**, módulo separado — ver §9). |

### 3.2 `Produto` — classificação fiscal

| Campo | Para quê |
|---|---|
| `ncm` (8 dígitos), `cfop` (4 dígitos) | Nomenclatura Comum do Mercosul e Código Fiscal de Operação — obrigatórios no cadastro, validados contra os catálogos de referência (`src/validators/produto.validator.js`). |
| `cstIbsCbs` (3 dígitos) | Código de Situação Tributária do IBS/CBS — validado contra `CatalogoCstIbsCbs`. |
| `cClassTrib` (6 dígitos) | Código de Classificação Tributária — validado contra `CatalogoClassTrib`. |
| `brstbs` | Nomenclatura Brasileira de Serviços — só quando o item é serviço, não obrigatório. |
| `configTributaria`, `origem` | Campos legados (pré-Reforma), sem consumidor na emissão hoje. |

**NCM, CFOP, CST-IBS/CBS e cClassTrib são obrigatórios em toda criação/edição de produto** desde `produto.validator.js` — decisão de produto registrada no próprio arquivo: cadastro é feito por gerente/funcionário sem pressão de tempo, não pelo caixa na hora da venda. Efeito colateral aceito: um produto cadastrado antes dessa obrigatoriedade precisa ser completado antes de qualquer nova edição.

### 3.3 `Venda` / `VendaItem` / `VendaPagamento`

Campos fiscais de `Venda`:

| Campo | Significado |
|---|---|
| `chaveNfce` | Chave de acesso de 44 dígitos. Pode estar preenchida **antes** de a nota ser autorizada (ver reserva síncrona, §5.1) — não confundir com "emitida". |
| `numeroNfce` | Número sequencial real (série 1). |
| `xmlNfce` | XML gerado — salvo **mesmo quando a SEFAZ rejeita** (é o registro do que foi de fato tentado). |
| `statusEmissaoFiscal` | Máquina de estados da emissão — ver tabela abaixo. |
| `tentativasEmissao`, `ultimaTentativaEm`, `proximaTentativaEm` | Controle do retry assíncrono. |
| `emitidoEm`, `protocoloAutorizacao` | Preenchidos só quando a SEFAZ autoriza de fato. |
| `emitidoViaContingencia` | `true` quando a nota que foi autorizada veio de um XML assinado offline (app ASSINATURA) e só transmitido depois — mesmo assim o campo `statusEmissaoFiscal` final é `emitido`, igual ao fluxo normal. |
| `canceladoEm`, `canceladoPor`, `motivoCancelamento`, `protocoloCancelamento` | Cancelamento — operacional e/ou fiscal, ver §5.5. |
| `dataVenda` vs `criadoEm` | `dataVenda` é o momento real da venda (pode ser retroativo numa sincronização tardia); `criadoEm` é o momento do INSERT no banco. A fila assíncrona ordena por `dataVenda`, porque o prazo legal de contingência conta a partir da venda real. |

Valores de `statusEmissaoFiscal`:

| Valor | Significado | Quem lê essa fila |
|---|---|---|
| `nao_aplicavel` | Tenant sem configuração fiscal completa — nunca entra em fila nenhuma. | — |
| `pendente` | Reservado (às vezes já com chave), aguardando o worker assíncrono tentar autorizar. | `filaEmissaoNfce.service.buscarPendentes` |
| `falha_temporaria` | Tentativa anterior falhou por conexão — aguardando `proximaTentativaEm`. | `filaEmissaoNfce.service.buscarPendentes` |
| `rejeitado` | SEFAZ recusou o **conteúdo** — não é reprocessado sozinho. | — |
| `contingencia_pendente_transmissao` | XML já assinado offline pelo app ASSINATURA, aguardando só a transmissão. | `filaTransmissaoContingencia.service.buscarPendentes` |
| `emitido` | Autorizado pela SEFAZ (normal ou via contingência). | — |

Campos fiscais de `VendaItem`: `valorIbs`, `valorCbs`, `cstIbsCbsAplicado`, `cClassTribAplicado` — **snapshot** do que foi calculado no momento da venda (se o cadastro do produto mudar depois, a venda antiga continua mostrando o que foi cobrado de fato).

`VendaPagamento.valorTributoSegregado` — placeholder de schema para o futuro "Split Payment" da Reforma (mecanismo de segregação automática do tributo no pagamento eletrônico, previsto no desenho público da Reforma — não pesquisei a base legal específica nesta sessão, então trato isso como contexto geral, não como fato confirmado no código). O comentário do próprio schema só diz: "nenhuma lógica de segregação real ainda, só o campo existindo pra não travar depois".

### 3.4 Catálogos de referência

Seis tabelas, todas populadas a partir de fontes oficiais (nunca digitadas à mão), usadas para **validar existência** no cadastro de produto (não só formato):

| Tabela | Fonte | Usada na emissão hoje? |
|---|---|---|
| `CatalogoNcm` | Nomenclatura Comum do Mercosul | Sim (grupo `prod`) |
| `CatalogoCfop` | Código Fiscal de Operação | Sim (grupo `prod`) |
| `CatalogoCst` | CST do ICMS regime normal (legado) | Não — tabela de referência pronta, sem consumidor |
| `CatalogoCsosn` | CSOSN do Simples Nacional (legado) | Não — idem |
| `CatalogoCstIbsCbs` | Informe Técnico RT 2025.002, `DOCS/cClassTrib 2026-06-22.xlsx`, aba "CST 2026-06-01 Pub" | **Sim — central** (grupo IBS/CBS) |
| `CatalogoClassTrib` | Mesmo Informe Técnico, aba "cClass 2026-06-01 Pub" | **Sim — central** |

`CatalogoCstIbsCbs.indGIbsCbs`/`indGRed` e `CatalogoClassTrib.pRedIbs`/`pRedCbs` são os quatro campos que decidem, respectivamente, se o grupo de valor é omitido (imunidade) e se há redução de alíquota — ver §4. Importados por `scripts/importarCatalogoClassTrib.js` (upsert idempotente, índices de coluna da planilha conferidos manualmente contra o cabeçalho real em 2026-07-18).

`CatalogoCstIbsCbs` e `CatalogoClassTrib` são pequenos e globais (18 e 164 códigos hoje, respectivamente, não por tenant — ver `catalogoFiscal.repository.js`) — por isso tanto `nfceEmissao.service.itensComTributo` quanto `pdvSnapshot.service.montar` buscam a tabela **inteira** de uma vez (2 queries fixas) e montam um mapa em memória, em vez de uma consulta por produto.

---

## 4. Cálculo do tributo — `src/services/tributoFiscal.service.js`

Função pura (sem banco, sem rede): `calcularTributoItem(tenant, produto, valorItem, classificacaoFiscal)`.

**Regra 1 — regime dispensado.** Se `tenant.regimeTributario` está em `REGIMES_DISPENSADOS_2026` (hoje só `'simples'` — `src/config/aliquotasFiscais.js`), devolve tudo zerado/nulo. **Isto está marcado no próprio código como pendente de confirmação contábil** — a leitura de que o Simples Nacional está dispensado do destaque em 2026 não foi confirmada contra o texto literal da lei, só contra fontes secundárias.

**Regra 2 — alíquota-teste 2026.** `ALIQUOTA_TESTE_2026 = { CBS: 0.009, IBS: 0.001 }` (0,9% + 0,1%). Fonte citada no código: Art. 346 e Art. 343, LC 214/2025, pesquisa externa em 2026-07-17 (fontes secundárias, não o Diário Oficial/Planalto diretamente). **Este valor SOBE e é SUBSTITUÍDO em 2027** — é por isso que fica isolado num único arquivo de config.

**Regra 3 — imunidade (indGIbsCbs=false, ex.: CST 410).** CST e cClassTrib são transmitidos, mas `valorIbs`/`valorCbs` saem zerados e o XML **omite o grupo `gIBSCBS` inteiro** (NT 2025.002, regra UB12-10 — "grupo informado indevidamente" é erro se vier em imunidade).

**Regra 4 — redução de alíquota (indGRed=true, ex.: CST 200, cesta básica).** O valor já sai calculado líquido da redução oficial:

```
fatorIbs = 1 - pRedIbs/100
valorIbs = arredondar(valorItem × 0,1% × fatorIbs)
```

`pRedIbs`/`pRedCbs` vêm do `cClassTrib` do produto (não do CST) — o mesmo CST 200 pode ter reduções diferentes dependendo do cClassTrib (ex.: cesta básica = 100% de redução, outros = 60%).

**Trava de segurança adicionada nesta sessão (2026-07-18):** se `indGRed=true` mas `pRedIbs`/`pRedCbs` vier `null` no catálogo, a função **lança erro** em vez de calcular. Antes dessa trava, `null / 100` em JavaScript vira `0` silenciosamente — o sistema aplicaria "0% de redução" (imposto cheio) sem avisar ninguém. Não é um cenário alcançável com o catálogo importado hoje (todo cClassTrib com CST `indGRed=true` tem os dois percentuais preenchidos), mas protege contra uma atualização futura da planilha oficial publicar um código incompleto.

Produto sem `cstIbsCbs`/`cClassTrib` preenchido (cadastro legado) faz a função lançar — nunca grava um código fictício num documento fiscal real.

---

## 5. Fluxo de venda ONLINE (backend acessível)

### 5.1 Registro da venda + reserva síncrona (`src/services/venda.service.js`, função `registrar`)

1. `configuracaoFiscalCompleta(tenantId)` checa se o tenant tem os campos obrigatórios preenchidos (`src/services/configuracaoFiscal.service.js` — certificado, senha, CSC de produção + ID, CNAE, regime, Inscrição Estadual, UF e todo o endereço). **Nenhuma chamada à SEFAZ acontece aqui** — é só um SELECT.
2. Se completa, **dentro da mesma transação que cria a Venda**, `nfceEmissao.service.reservarNumeroEChaveNfceNaTransacao` incrementa `Tenant.ultimoNumeroNfce` e monta a chave de acesso definitiva (44 dígitos, DV calculado de verdade). Isso existe para o **DANFE poder ser impresso na hora**, com QR Code válido, sem esperar a autorização real (que é assíncrona) — mas **a chave existir não significa que a nota foi autorizada**. `statusEmissaoFiscal` fica `pendente`.
3. Se a transação inteira reverter (ex.: retry por lock timeout), o incremento do contador reverte junto — nunca "gasta" um número por uma tentativa que não virou venda de verdade.

### 5.2 Fila assíncrona de emissão (`src/services/filaEmissaoNfce.service.js`)

Roda via cron em `src/server.js`, a cada `NFCE_PROCESSAMENTO_MINUTOS` (padrão 2 minutos). `buscarPendentes()` pega vendas `pendente` ou `falha_temporaria` (com `proximaTentativaEm` já vencido), **excluindo vendas com `status='cancelada'`** (proteção adicionada nesta sessão — sem ela, cancelar uma venda ainda pendente não impedia o worker de emitir uma NFC-e "fantasma" para ela depois).

Para cada venda, chama `nfceEmissao.service.emitirNfce`, que:
- Recalcula o tributo de cada item em lote (`itensComTributo` — 2 queries fixas no catálogo para a venda inteira, não 2×N).
- Reaproveita o `numeroNfce`/`chaveNfce` já reservados (nunca recalcula) — se recalculasse, a chave transmitida à SEFAZ divergiria da chave já impressa e entregue ao cliente.
- Monta o XML (`nfceXml.service.gerarXmlNfce`, ver §5.3 abaixo).
- Chama o webservice (mock em dev/teste; real fora disso).
- Grava o XML **sempre** (mesmo rejeitado); se `cStat=100`, grava `chaveNfce`, `emitidoEm`, `protocoloAutorizacao`.

Classificação de erro: falha de **conexão** (regex contra assinaturas conhecidas: `ECONNREFUSED`, `ETIMEDOUT`, etc.) vira `falha_temporaria` com retry em `NFCE_RETRY_MINUTOS` (padrão 5min); rejeição de **conteúdo** (a SEFAZ respondeu recusando) vira `rejeitado`, sem retry automático — precisa de correção manual.

**Decisão registrada "SEM CONTINGÊNCIA SVC":** o sistema NÃO declara contingência formal (tpEmis≠1) para a SEFAZ do estado estar fora do ar. Duas tentativas anteriores foram revertidas — contingência formal exige QR Code v3 com assinatura digital, mecanismo que a lib usada (`@nfewizard/nfce` 1.0.4) não suporta (gera QR sempre em v2). Em vez disso: uma tentativa no webservice principal; se falhar por conexão, a fila tenta de novo mais tarde, no mesmo endpoint, até a SEFAZ do estado voltar.

### 5.3 Montagem do XML — `src/services/nfceXml.service.js`

Serviço puro (sem Prisma, sem rede). `gerarXmlNfce(venda, opcoes)` monta:

- `ide`: número, série (fixa "1"), data de emissão, tipo de emissão, UF, ambiente, chave de acesso (reaproveitada se já reservada, ou montada aqui).
- `emit`: CNPJ, nome, endereço completo, CRT (`MAPA_CRT` — Simples=1, Presumido/Real=3).
- `det[]` — por item: `prod` (NCM, CFOP, quantidade, valores) e `imposto.IBSCBS` (grupo da Reforma, omitido inteiro se o tenant está num regime dispensado).
- `total`, `transp` (sempre "sem transporte" — NFC-e de balcão), `pag`.

**Grupo IBSCBS por item** (`montarGrupoIbsCbs`) — estrutura confirmada contra o XSD real (`@nfewizard/shared`, `DFeTiposBasicos_v1.00.xsd`) e contra a NT 2025.002-RTC v1.50 (regras UB12-10, UB64-10/UB64-20, UB65-10/UB66-10):

- `pIBSUF`/`pCBS` mostram **sempre** a alíquota estatutária cheia (0,10%/0,90%), mesmo quando há redução — é a regra UB56-10 da NT ("a tag pCBS deve ser igual a 0,9%..."). O efeito da redução aparece só no subgrupo `gRed`.
- `gRed` (quando `indGRed=true`): `pRedAliq` (percentual de redução) e `pAliqEfet` (alíquota líquida = estatutária × (1 − redução)).
- `gIBSMun` sempre `0,00` em 2026 — Art. 343, LC 214/2025 (parágrafo único): o IBS-teste de 2026 é **100% estadual por lei**, essa arrecadação sai das repartições constitucionais normais.
- **Guarda de vigência 2027**: `VIGENCIA_RATEIO_ESTADUAL_FIM = 2027-01-01`. A partir dessa data, o Art. 344 muda o rateio para 0,05% estadual + 0,05% municipal — regra ainda **não implementada**. O código **lança erro** em vez de continuar emitindo 100/0 silenciosamente errado numa venda com `dataEmissao` de 2027 em diante. Implementada tanto no backend quanto no PDV (`vigia-pdv/.../nfceContingencia.js`).

`montarUrlQrCode(tenant, chaveAcesso, urlConsulta)` — QR Code v2 (via CSC): `SHA-1(chaveAcesso + tpAmb + idCSC + CSC)`, formato `url?p=chave|2|tpAmb|idCSC|hash`. Endpoint separado (`GET /api/vendas/:id/qrcode`, `venda.service.buscarQrCode`) — chamado pelo PDV depois que a venda já foi registrada, "melhor esforço": se falhar (ex.: CSC do ambiente atual não configurado), o cupom ainda é impresso, só sem QR Code.

### 5.4 Emissão real — `src/services/nfceEmissao.service.js`

Usa `@nfewizard/nfce` (`NFCEWizard`). Achados de investigação estrutural (contra a SEFAZ-PR de homologação, certificado dummy):

- O validador de schema **padrão** da lib é Java-based — `useForSchemaValidation: 'validateSchemaJsBased'` é configurado explicitamente, senão toda emissão exigiria JDK instalado no servidor.
- A lib **joga fora o erro original** ao relançar — perde `.code`/`.isAxiosError`. `ehFalhaDeRede()` classifica por assinatura de mensagem (conservador: só reconhece padrões conhecidos de falha de rede).
- Um `NFCEWizard` novo é criado a cada chamada (nunca reaproveitado) — o Environment guarda certificado/CNPJ do tenant, e isso é multi-tenant: reaproveitar arriscaria vazar configuração de um tenant pra outro em chamadas concorrentes.

`mockAtivo()` — `SEFAZ_MOCK=true` **ou** `NODE_ENV=test`. Em teste/mock, a "chamada" devolve sucesso determinístico sem rede nem certificado real. **Fora disso, a chamada é real.** Não há como eu confirmar o valor efetivo de `SEFAZ_MOCK`/`NODE_ENV` no ambiente de produção (Railway) — isso só existe no painel externo, não no código.

### 5.5 Cancelamento — `venda.service.cancelar` + `nfceEmissao.service.cancelarNfce`

Implementado nesta sessão (antes, `cancelarNfce` existia e era testado, mas não estava pendurado em nenhuma rota — cancelar uma venda revertia estoque/caixa e nunca avisava a SEFAZ).

Pesquisa confirmou (fontes de mercado, não Diário Oficial direto): o evento de cancelamento (tipo 110111) só é aceito pela SEFAZ para documento **já autorizado** (exige `nProtEvento` — protocolo de autorização). NFC-e rejeitada, ou ainda não transmitida, não tem protocolo — mandar um cancelamento pra ela seria recusado.

Por isso `venda.service.cancelar` ramifica por `statusEmissaoFiscal`:

| Estado | Ação |
|---|---|
| `emitido` (normal ou via contingência) | `cancelarNfce` roda **primeiro**. Checa janela de tempo (30 minutos após a autorização — `JANELA_CANCELAMENTO_PADRAO_MINUTOS`, `src/config/webservicesSefaz.js`, valor nacional padronizado pra NFC-e, sem exceção por UF confirmada) e justificativa mínima (15 caracteres). Se **falhar** (janela expirada, SEFAZ recusa, rede fora), a exceção propaga e **a venda inteira não é cancelada** — nem estoque nem caixa mudam. Decisão explícita: evita o estado "operacionalmente cancelada, mas ainda autorizada pra SEFAZ" sem nenhum retry automático. |
| Qualquer outro (`pendente`, `falha_temporaria`, `rejeitado`, `nao_aplicavel`, `contingencia_pendente_transmissao` ainda não transmitida) | Só cancelamento operacional (estoque/caixa) — nada é enviado à SEFAZ. As duas filas assíncronas (`filaEmissaoNfce`/`filaTransmissaoContingencia`) já filtram `status≠'cancelada'`, então nunca processam essa venda depois. |

**Débito técnico conhecido e documentado (não implementado):** quando uma venda com número **já reservado** (mas nunca transmitido) é cancelada, esse número fica como buraco na sequência da série 1. Legalmente isso exige **Inutilização de Numeração** — evento fiscal formal e diferente do cancelamento, com prazo próprio (até o dia 10 do mês seguinte ao mês da quebra — fonte de mercado, não primária). Essa rotina não existe no sistema hoje; `statusEmissaoFiscal` é deixado intacto de propósito nesses casos, para uma futura rotina conseguir localizar exatamente essas vendas.

O `cancelarNfce`, quando roda de verdade (`enviarEventoCancelamentoReal`), usa `NFCEWizard.NFCE_Cancelamento` — formato confirmado lendo o `.d.ts` da lib e testado estruturalmente. `dhEvento` usa offset fixo `-03:00` (Brasília, sem horário de verão desde 2019) — **assunção incorreta para tenants em UF de fuso diferente** (AC, oeste do AM), sem tratamento especial em nenhum lugar do sistema hoje.

---

## 6. Contingência offline — as três camadas

Cenário: o PDV não consegue falar com o backend (queda de internet da loja). A venda **precisa** continuar acontecendo — o sistema tenta, em melhor esforço, assinar uma NFC-e de verdade na hora, usando o certificado que só existe na máquina do gerente.

### 6.1 App ASSINATURA (`vigia-pdv-assinatura`)

- **Login do gerente** (`src/main/auth/authClient.js`): busca o certificado (`GET /api/fiscal/certificado`, exige permissão `assinatura_fiscal` com nível `acesso_completo`) **e** a chave de pareamento (`GET /api/fiscal/chave-assinatura-local`, qualquer usuário autenticado do tenant) do backend, na mesma chamada de login.
- **Armazenamento local** (`src/main/certificado/certificadoStore.js`): certificado + senha + chave de pareamento, protegidos por `safeStorage` do Electron (DPAPI do Windows) — nunca em texto plano em disco.
- **Servidor HTTP local** (`src/main/servidor/servidorAssinatura.js`): escuta em `0.0.0.0:49215` (todas as interfaces da rede da loja). Três rotas:
  - `POST /reservar-numero-contingencia` — devolve `{numero, serie}` de um contador **local**, em arquivo JSON (`src/main/contador/contadorContingencia.js`). Série **dedicada (2)**, nunca usada pela série online (1) — decisão que elimina qualquer risco de colisão sem precisar coordenar com o backend, já que o PDV assina sem rede. Compartilhado por todos os PDVs da loja através deste mesmo servidor (leitura+incremento+escrita são síncronos, sem `await` no meio — o processo Node é single-threaded, então isso sozinho evita dois PDVs recebendo o mesmo número).
  - `POST /assinar-teste` / `POST /assinar` — assina XML com o certificado (via `xml-crypto` + `node-forge`, não via `@nfewizard/shared` — essa lib exige compilar um binding nativo em C++, inviável no instalador do app do gerente). `/assinar` devolve também a assinatura do QR Code v3 de contingência (NT 2025.001): `base64(RSA-SHA1("chNFe|3|tpAmb|dia|valor|tpIdDest|cDest", chave privada))`, fórmula confirmada contra a implementação de referência de mercado `nfephp-org/sped-nfe`.
  - **Autenticação (adicionada nesta sessão):** toda requisição precisa do header `Authorization: Bearer <chaveAssinaturaLocal>`, comparado em tempo constante (`crypto.timingSafeEqual`). Antes disso, **qualquer dispositivo na rede Wi-Fi da loja conseguia pedir uma assinatura com o certificado real do tenant sem provar nada** — a chave de pareamento fecha esse buraco.

### 6.2 PDV (`vigia-pdv`)

- **Snapshot local**: a cada sincronização normal, o backend manda (`GET /api/pdv/snapshot`, `src/services/pdvSnapshot.service.js`) um bloco `fiscal` com os dados do tenant já pré-calculados (CRT, `emiteIbsCbs`, alíquotas, endereço) **e**, por produto, os indicadores `cstIbsCbs`/`cClassTrib`/`indGIbsCbs`/`indGRed`/`pRedIbs`/`pRedCbs` já resolvidos contra o catálogo oficial — o PDV nunca decide/calcula isso sozinho, só recebe pronto e guarda em SQLite (`vigia-pdv/src/main/db/snapshotDb.js`).
- **Detecção de offline + assinatura** (`Pagamento.jsx` → `services/vendaContingencia.js`): se `POST /api/vendas` falhar por rede, a venda vai pra fila local **e**, em paralelo, tenta assinar em contingência:
  1. `validarParaContingencia(venda, fiscal)` — checa UF, guarda de vigência 2027, e a classificação fiscal completa de cada item **antes** de reservar qualquer número (adicionado nesta sessão: antes, um produto com dado inválido só era descoberto **depois** de já ter reservado — e queimado — um número da série de contingência, sem jeito de devolver).
  2. `assinaturaClient.reservarNumero()` no app ASSINATURA.
  3. `nfceContingencia.gerarXmlNfceContingencia()` monta o XML localmente (tpEmis=9, mesma estrutura de grupo IBS/CBS do backend, mesmo cálculo de tributo, mesma guarda de vigência 2027) — função pura, testável sob Node puro.
  4. `assinaturaClient.assinar()` manda pro app ASSINATURA assinar de verdade.
  - **Tudo isso é melhor esforço** — a função `tentarAssinarContingencia` nunca lança; qualquer falha vira `{assinado: false, motivo}` e a venda segue offline de qualquer jeito, só sem XML assinado ainda (será tentada de novo só no próximo checkout, não há retry automático desta assinatura específica).
  - **Número queimado sem uso** (risco residual, tratado nesta sessão): mesmo com a validação prévia do passo 1, ainda existe uma janela entre `reservarNumero()` (passo 2) e `assinar()` (passo 4) em que uma falha genuína de rede/timeout deixa um número já reservado no contador do ASSINATURA sem nenhuma NFC-e correspondente — o contador não tem como "devolver" (`contadorContingencia.js`). Não dá pra eliminar essa janela (não é bug, é a natureza de um contador local sem transação distribuída com o passo de assinatura), só **rastrear**: o catch interno de `tentarAssinarContingencia` anexa `numeroQueimado`/`serieQueimada` (campos estruturados, não só embutidos no texto de `motivo`) ao resultado; `Pagamento.jsx` salva isso na fila local; `venda.service.sync()` no backend (§6.3) grava o evento em `Auditoria` — consultável depois por quem for preparar a Inutilização de Numeração manual (ver §9).
- **DANFE** (`components/Danfe.jsx`): cupom impresso (CSS `@media print`, isolado do resto da tela). Mostra QR Code (gerado localmente com a lib `qrcode` a partir do conteúdo recebido — nunca decide o que vai dentro), chave de acesso formatada, e, em contingência, o aviso "EMITIDA EM CONTINGÊNCIA — PENDENTE DE AUTORIZAÇÃO" com a justificativa (exigência da MOC 7.0 Anexo IV).
- **Campos obrigatórios de contingência** (MOC 7.0, Anexo IV — CONFAZ/ENCAT): `tpEmis=9`, `dhCont` (momento de entrada em contingência), `xJust` (mínimo 15 caracteres — mesmo padrão do cancelamento).
- **Prazo de regularização**: `PRAZO_REGULARIZACAO_HORAS = 24` — regra **específica da SEFAZ-PR** (RICMS/PR, Anexo IX, Art. 10 §15-16), mais rígida que o prazo genérico nacional (fim do 1º dia útil seguinte, Ajuste SINIEF 19/2016). Se o sistema um dia atender tenant de outra UF, essa constante precisa virar parametrizável — hoje é fixa.

### 6.3 Backend — recepção e transmissão da contingência

- `POST /api/sync/vendas` (via `venda.service.sync` → `registrar`, campo `contingencia` só é lido nesse caminho, nunca em `POST /api/vendas` direto — proteção contra um client malicioso forjar uma nota já "assinada"): quando `contingencia.assinado===true`, grava `chaveNfce`/`xmlNfce` **exatamente como vieram** (nunca passam pelo gerador normal, que criaria um documento diferente do que o cliente já recebeu no cupom) e `statusEmissaoFiscal='contingencia_pendente_transmissao'` — nunca `'pendente'`, para o worker normal jamais gerar uma segunda NFC-e do zero para a mesma venda.
- **Número de contingência queimado** (`venda.service.registrarNumeroContingenciaQueimado`, chamado de dentro de `sync()`): quando `venda.contingencia.numeroQueimado` vem preenchido (reserva no ASSINATURA que nunca virou NFC-e — ver §6.2), grava um evento em `Auditoria` (`entidade='ContingenciaNfce'`, `depois={numero, serie, motivo, localId, dataVenda}`) **independente** do resultado do `registrar()` da venda em si — o número já foi queimado de verdade no PDV antes de chegar aqui, é um fato à parte que vale a pena registrar mesmo que a venda seja rejeitada por outro motivo. Usa a tabela `Auditoria` genérica (já existente, sem migration nova) em vez de uma tabela dedicada — não há automação de Inutilização ainda (ver §9), só uma lista consultável manualmente.
- **Fila de transmissão** (`src/services/filaTransmissaoContingencia.service.js`, cron separado em `server.js`): pega vendas `contingencia_pendente_transmissao`, chama `nfceContingenciaTransmissao.service.transmitirContingencia`.
- `nfceContingenciaTransmissao.service.js` — **não usa `@nfewizard/nfce`**: essa lib reconstrói e reassina o XML internamente ao receber uma string, o que produziria um documento diferente do já entregue ao cliente. Em vez disso, fala SOAP 1.2 diretamente com o webservice de autorização da UF (envelope confirmado contra múltiplas implementações de mercado ativamente mantidas — `nfephp-org/sped-nfe`, ACBr, DFe.NET). **Nunca testado contra um ambiente real** (nem homologação) nesta sessão, por falta de certificado real e acesso de rede confiável a domínios `.gov.br` no ambiente de desenvolvimento — pendência real, sinalizada no próprio arquivo.
- Sucesso (`cStat=100`): `statusEmissaoFiscal='emitido'`, `emitidoViaContingencia=true`.

---

## 7. Segurança

| Segredo | Onde vive | Como é protegido |
|---|---|---|
| Certificado A1 (.pfx) + senha | `Tenant.certificadoPfx/Senha` (Postgres) e cache local do app ASSINATURA | AES-256-GCM (`certcrypto.js`) no banco; `safeStorage` (DPAPI) no app ASSINATURA. Nunca no vigia-pdv. |
| CSC produção/homologação | `Tenant.cscProducao/Homologacao` | AES-256-GCM. Usado só para montar hash do QR Code, nunca exposto cru. |
| `chaveAssinaturaLocal` | `Tenant.chaveAssinaturaLocal`, cache local dos dois apps Electron | AES-256-GCM no banco (mesma chave mestra do certificado); `safeStorage` no app ASSINATURA; **texto plano** no `sessao-loja.json` do vigia-pdv (mesmo tratamento que `ipGerente`/`tenantId` já recebiam — se esse arquivo vazar, o alcance é o mesmo que já existia antes desta chave existir: acesso à rede da loja). |
| `Bearer <chaveAssinaturaLocal>` | Header HTTP entre vigia-pdv e o app ASSINATURA | Comparação em tempo constante (`crypto.timingSafeEqual`) — nunca aceita header vazio/ausente mesmo que a chave configurada também esteja vazia. |

**Permissão `assinatura_fiscal`** (`src/utils/modulos.js`) — módulo dedicado, com `exigeAcessoCompleto` (não o `exigePermissao` genérico) na rota do certificado: qualquer nível de leitura menor que "acesso completo" não consegue extrair o certificado. Já a chave de pareamento (`chave-assinatura-local`) **não** exige esse módulo — qualquer operador de PDV do tenant precisa dela para vender em contingência, não só o gerente.

---

## 8. NF-e de entrada — módulo separado (não é NFC-e)

`src/services/sefaz.service.js` (nome parecido, responsabilidade diferente): trata da **Distribuição DF-e** e **Manifestação do Destinatário** — as notas fiscais que **fornecedores** emitem contra o CNPJ do tenant (entrada de mercadoria), usando `@vexta-systems/node-mde`. Compartilha o mesmo certificado A1 do Tenant, mas é um fluxo totalmente separado da emissão de NFC-e:

- `sincronizar()`: consome o cursor `Tenant.ultimoNsu`, baixa resumos/XMLs completos/eventos, persiste em `NfeDistribuicao`.
- `manifestar()`: envia Ciência da Operação (ou outro evento) para as chaves informadas.
- `baixarXml()`: baixa o XML completo de uma nota já manifestada.

Não é afetado pela Reforma Tributária 2026 nem pelo restante deste documento — mencionado aqui só porque usa a mesma infraestrutura de certificado.

---

## 9. O que está confirmado vs. pendente de validação

### Confirmado por pesquisa em fonte externa (não primária — sinalizado no próprio código)
- Alíquota-teste 2026: 0,9% CBS + 0,1% IBS (Art. 343/346, LC 214/2025).
- IBS-teste 2026 é 100% estadual (Art. 343, parágrafo único).
- Rateio muda em 01/01/2027 para 0,05%/0,05% (Art. 344).
- Regras de estrutura do grupo IBS/CBS, gRed, imunidade — NT 2025.002-RTC (PDF oficial baixado de nfe.fazenda.gov.br).
- Cancelamento só vale para documento autorizado; janela de 30 minutos é o padrão nacional para NFC-e.
- Inutilização de Numeração é obrigatória para número nunca transmitido, prazo até o dia 10 do mês seguinte.

### Pendente de confirmação jurídica/contábil (não decidido pelo código, nem por mim)
- Se o Simples Nacional está mesmo dispensado do destaque de IBS/CBS em 2026 (`REGIMES_DISPENSADOS_2026`) — não confirmado contra o texto literal da lei.
- Exceção de janela de cancelamento por UF específica para NFC-e (hoje todas usam 30 minutos).
- Distribuição de contingência SVC por UF (SVC-RS usado para todas, algumas oficialmente são SVC-AN).

### Pendências técnicas conhecidas (documentadas no código, não implementadas)
- Inutilização de Numeração — sem nenhuma implementação (nem SOAP, nem worker, nem endpoint na tabela de UFs). O que existe agora (adicionado nesta sessão) é só o levantamento do que precisaria ser inutilizado: números de contingência queimados por falha pós-reserva ficam registrados em `Auditoria` (`acao='numero_contingencia_queimado'`, ver §6.3) — uma lista consultável manualmente, não um envio automático à SEFAZ.
- Rateio 50/50 estadual/municipal de 2027 — bloqueado com erro proposital em vez de implementado.
- Imposto Seletivo — todas as regras da NT marcadas "Implementação Futura", sem prazo confirmado.
- CST 620 (monofásico) — reformulado na NT v1.50, não revisado.
- `nfceContingenciaTransmissao.service.js` (SOAP direto) nunca testado contra ambiente real.
- `vTroco` (troco em dinheiro) ausente do XML/DANFE — não confirmado se é campo opcional ou exigido nesse cenário.
- Nenhuma tela no sistema mostra `statusEmissaoFiscal` para o dono da loja — só o Super Admin vê isso hoje (`public/superadmin.html`).
- `dhEvento` do cancelamento e `dhEmi`/chave de acesso usam offset fixo `-03:00` — incorreto para UFs de fuso diferente (AC, oeste do AM).

---

## 10. Glossário rápido

| Termo | Significado |
|---|---|
| **NFC-e** | Nota Fiscal de Consumidor eletrônica — modelo 65, documento fiscal da venda ao consumidor final. |
| **CST-IBS/CBS** | Código de Situação Tributária do IBS/CBS (3 dígitos) — classifica o tipo de tributação do item (integral, reduzida, imune...). |
| **cClassTrib** | Código de Classificação Tributária (6 dígitos) — refina o CST, é dele que vem o percentual de redução. |
| **gRed** | Subgrupo do XML com o percentual e o efeito líquido de uma redução de alíquota. |
| **CRT** | Código de Regime Tributário (1=Simples, 3=Presumido/Real). |
| **CSC** | Código de Segurança do Contribuinte — usado só para montar o hash do QR Code. |
| **tpEmis** | Tipo de emissão — `1` normal, `9` contingência offline. |
| **Evento de cancelamento (110111)** | Mensagem separada enviada à SEFAZ para anular uma nota já autorizada. |
| **Inutilização de Numeração** | Evento separado, para declarar formalmente que um número nunca será usado (não confundir com cancelamento). |
| **DANFE NFC-e** | Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica — o cupom impresso (texto exato usado em `Danfe.jsx`). |
| **MOC** | Manual de Orientação do Contribuinte — especificação técnica oficial do layout NFC-e. |
| **NT 2025.002-RTC** | Nota Técnica que define o layout de IBS/CBS/IS na NF-e/NFC-e pós-Reforma. |
