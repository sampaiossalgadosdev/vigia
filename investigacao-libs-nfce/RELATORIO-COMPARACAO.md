# Investigação — Bibliotecas de Emissão Real de NFC-e

**Data:** 2026-07-12
**Ambiente:** Windows 11, Node.js v24.14.1, npm (via Git Bash)
**Escopo:** Só investigação/spike. Nenhum código de produção foi escrito. Nenhum arquivo em `src/`, `prisma/schema.prisma` ou qualquer parte do app principal foi alterado (confirmado no fim deste documento).

---

## 0. Nota preliminar — fixture que faltava

O prompt assumia que `src/tests/fixtures/certificado-teste.pfx` (senha `senha123`) já existia. **Não existia.** Gerei o certificado dummy autoassinado com o script `fixtures/gerar-certificado-dummy.js` (dentro desta pasta de investigação, usando `node-forge` que já é dependência do app principal) e salvei o resultado exatamente nesse caminho, já que prompts futuros da Fase 1c provavelmente vão continuar referenciando esse arquivo. Isso é a única coisa que toca em `src/` — é um fixture binário de teste, não código.

---

## 1. Tabela comparativa

| Critério | **node-dfe** | **@nfewizard/nfce** / nfewizard-io | **Focus NFe** (serviço pago) |
|---|---|---|---|
| Versão testada | 0.0.25 | 1.0.4 / 1.1.1 |  N/A |
| Licença (confirmada no arquivo LICENSE real) | **MIT** | **GPL-3.0** (confirmado, não é só o resumo do npm) | Serviço, sem licença de código |
| Requer JDK? | **Não** | **Sim, para o validador de schema padrão** (erro reproduzido: `Java SDK required at JAVA_HOME or in path`). Existe workaround documentado (`useForSchemaValidation: 'validateSchemaJsBased'`) que evita o JDK — mas há **outro** módulo nativo (`libxmljs2`) na árvore que também precisa de binário compilado/prebuilt | N/A (é API HTTP) |
| Dependência nativa (build) | **Sim** — `node-expat` (via `cxsd`), falhou por falta de Visual Studio C++ Build Tools nesta máquina. Só é usado em tempo de build/codegen do próprio pacote (não é tocado em runtime pelo `require('node-dfe')`) | **Sim** — `libxmljs2` (prebuild-install; funcionou depois de `npm rebuild` isolado). É runtime, não só build | N/A |
| `npm install` direto funciona? | ❌ falha (node-gyp sem VS Build Tools) — precisa `--ignore-scripts` | ❌ falha (JDK ausente aborta o install inteiro, comportamento padrão do npm) — precisa `--ignore-scripts` + depois `npm rebuild libxmljs2` separado | N/A |
| Vulnerabilidades (`npm audit`) | **18** (6 moderate, 8 high, **4 critical**) — via `request`, `hawk`, `hoek`, `tough-cookie` etc., stack de HTTP de ~2016 | **2** high | N/A |
| Manutenção | Última publicação **+1 ano atrás**; README pede ajuda de contribuidores ("HELP WANTED") | Publicado **há 1 mês**; menciona explicitamente NT 2025.002 (Reforma Tributária) | Empresa ativa |
| Suporta NFC-e modelo 65? | ✅ Confirmado no código (`modelo: '65'` tratado em vários processors) | ✅ Confirmado (é o pacote inteiro, `@nfewizard/nfce`) | ✅ (produto "Retail") |
| Cancelamento de NFC-e | ✅ Implementado (`EventoProcessor`, tpEvento 110111, campos `nProt`/`xJust` **exatamente** como eu tinha inferido por analogia na Fase 1c) | ✅ Documentado com exemplo completo (mesmos campos `nProt`/`xJust`) | ✅ via API |
| Consulta de protocolo | ✅ Implementado (`RetornoProcessor`, com retry/polling embutido) | ✅ Documentado (`NFCERetornoAutorizacao`) | ✅ via API |
| Formato de retorno (cStat/xMotivo/protocolo) | Estrutura própria (`{success, data, error}`) — dá pra mapear pro que `nfceEmissao.service.js` espera, mas exige um adaptador (uns 30-50 linhas) | Não cheguei a confirmar em teste real (ver §3) — API própria, também exigiria adaptador | JSON HTTP, mapeamento direto e simples |
| Teste com certificado dummy | ✅ **Sucesso estrutural completo**: abriu o .pfx, assinou XML, e a chamada real à SEFAZ-PR homologação retornou exatamente o erro esperado (`SSL alert: certificate unknown` — confirma que chegou na SEFAZ e foi rejeitado só por não ser ICP-Brasil real) | 🟡 **Parcial**: carregou o logger e iniciou a validação de config, mas bati em **3 incompatibilidades reais entre o README e a versão publicada** (nome do construtor, nome do método, formato do objeto de config) — não cheguei a confirmar carregamento do certificado dentro do orçamento de tempo desta investigação | N/A (não testável sem conta) |
| Achado de segurança | 🔴 **Loga a senha do certificado e a chave privada em texto puro no `console.log` a cada chamada SOAP** (confirmado lendo o código: `agentOptions: {passphrase: 'senha123', key: '-----BEGIN RSA PRIVATE KEY...', ...}` impresso no stdout) | Não verificado a fundo (tem sistema de log estruturado em JSONL, que é uma prática melhor — não testei se ele também vaza segredo) | N/A |
| Qualidade de packaging | Comentários "TODO" no código, mas estrutura limpa | Pacote publicado parece incluir uma pasta de **cache de build do Rollup** (`.rollup.cache/usr/projetos/nfewizard/...`) dentro do próprio `node_modules` — indício de descuido no processo de release | N/A |
| Cobertura de UF testada pelo autor (admitido no próprio projeto) | "Cancelamento, Carta de Correção e Inutilização devem ser testadas em outras UF... testes apenas em SP" | "Testado principalmente para São Paulo. Abra uma issue caso encontre problemas com outros estados" | Empresa faz isso profissionalmente, cobertura de UF é responsabilidade deles |
| Tabela de URLs por UF (bônus) | Bundled (`autorizadores.json`/`autorizadoresNFe.json`) — **URL da PR bate byte-a-byte com a que pesquisei via ACBr na Fase 1c**, boa validação cruzada | Não explorado | N/A (a empresa cuida disso) |
| Complexidade de integração estimada com `nfceEmissao.service.js` atual | **Média** — trocar `chamarWebserviceReal` por um adaptador que usa `NFeProcessor`/`EventoProcessor`/`RetornoProcessor`; extrair key/pem do .pfx (não vem de graça, mas é código que eu já sei escrever, feito nesta investigação); resolver o achado de segurança (silenciar os `console.log` internos é possível via patch/fork, mas é gambiarra) | **Média-Alta** — API ainda instável/mudando entre versões (3 incompatibilidades reais encontradas em poucos minutos de uso), exigiria testes mais extensos antes de confiar; dependência de dois "modos nativos" (JDK opcional + libxmljs2 obrigatório) complica o Dockerfile | **Baixa** — é chamada HTTP/JSON, sem lib nativa, sem certificado pra gerenciar no seu lado (a empresa cuida da assinatura) |

---

## 2. Detalhamento por tarefa

### Tarefa 1 — Instalação e requisitos técnicos

**node-dfe** (`npm view`: MIT, 9 deps diretas). `npm install node-dfe` **falhou** nesta máquina:
```
npm error gyp ERR! find VS Could not find any Visual Studio installation to use
npm error gyp ERR! cwd .../node_modules/node-expat
```
Precisei rodar `npm install node-dfe --ignore-scripts` (118 pacotes instalados). `npm audit`: **18 vulnerabilidades (6 moderate, 8 high, 4 critical)**, majoritariamente do stack antigo de `request@2.69.0` (deprecado desde 2020) que a lib usa **de verdade** para as chamadas SOAP (não é dependência morta — `webserviceHelper.js` chama `request.post` diretamente). `node-expat` só é usado pelo script `cxsd` de geração de tipos (dev-time), não em runtime — confirmei isso lendo o `lib/index.js` compilado, que não referencia `cxsd` em nenhum lugar.

LICENSE real (arquivo, não resumo do npm): MIT, Guilherme Leal, 2022. ✅ Sem problema de copyleft.

**@nfewizard/nfce + nfewizard-io** (`npm view`: GPL-3.0 em ambos, poucas deps diretas — axios/date-fns/node-fetch/pako, nada de stack legado). `npm install` **falhou** — mas por um motivo diferente e mais sério, porque é um erro **fatal que aborta o install inteiro** (comportamento padrão do npm quando um script de post-install de qualquer dependência falha):
```
npm error [xsd-schema-validator] Compiling helper...
npm error Error: Java SDK required at JAVA_HOME or in path to compile validation helper
```
Reproduzido literalmente, confirma 100% a suspeita do prompt. O README **já documenta isso** e oferece um workaround (`useForSchemaValidation: 'validateSchemaJsBased'`), mas isso só evita o *uso* do validador Java — o `npm install` **continua tentando compilar o helper Java de qualquer jeito** (o script de post-install roda incondicionalmente), então em CI/Docker isso ainda quebraria o build a menos que se use `--ignore-scripts` globalmente. E `--ignore-scripts` também impede `libxmljs2` (outro módulo nativo, usado de verdade em runtime, ao contrário do `node-expat` do node-dfe) de baixar seu binário pré-compilado — precisei rodar `npm rebuild libxmljs2` isoladamente depois pra resolver isso. **Ou seja: o Dockerfile de deploy precisaria ou (a) instalar um JDK, ou (b) fazer esse instalação em duas etapas (--ignore-scripts + rebuild seletivo)** — nenhuma das duas é trivial num `npm ci` padrão de CI/CD.

LICENSE real (arquivo, checado em `nfewizard-io`, `@nfewizard/nfce` e `@nfewizard/shared`): **GPL-3.0 completo, texto integral da FSF**, confirmado — não é um resumo impreciso do npm. `npm audit`: 2 vulnerabilidades high (bem menos que node-dfe).

⚠️ **Sobre a licença GPL-3.0**: o VIGIA é um SaaS comercial de código fechado. GPL-3.0 é copyleft — a interpretação de como isso se aplica a uma **dependência de biblioteca via npm** (vs. distribuir/vender o próprio código da lib) varia (há entendimentos de que usar uma lib GPL como dependência de um serviço rodando no seu servidor, sem distribuir o binário da lib pro cliente, pode não acionar a obrigação de abrir o código do VIGIA todo — isso é o argumento comum por trás de "SaaS loophole" da AGPL vs GPL, mas GPL-3.0 comum tem menos ambiguidade que AGPL nesse ponto específico). **Não estou dando parecer jurídico definitivo — isso precisa ser confirmado com advogado/contador antes de decidir usar esta lib em produção.**

### Tarefa 2 — Teste estrutural com certificado dummy

**node-dfe**: ✅ **Sucesso completo em todos os 4 passos**:
1. `.pfx` aberto sem erro via node-forge (extraí key+cert em PEM, formato que `node-dfe` espera separadamente do `.pfx` bruto).
2. `Signature.signXmlX509()` assinou um XML de teste sem exceção.
3. `gerarQRCodeNFCeOnline()` gerou uma URL de QR Code nativamente, sem rede.
4. Chamada real ao webservice de homologação da SEFAZ-PR (`StatusServicoProcessor`, consulta de status — não emite nada) retornou:
   ```
   Error: write EPROTO ...ssl3_read_bytes:ssl/tls alert certificate unknown
   ```
   Isso é **exatamente o erro esperado**: a conexão TLS chegou até o servidor real da SEFAZ, que rejeitou nosso certificado dummy por não ser uma cadeia ICP-Brasil confiável — confirma que a lib monta a chamada corretamente até esse ponto.

   **Achado de segurança durante esse mesmo teste**: capturei no stdout, sem pedir, o objeto `agentOptions` inteiro sendo logado por `console.log()` dentro de `webserviceHelper.js`, incluindo `passphrase: 'senha123'` em texto puro e a chave privada PEM completa. Isso acontece **a cada chamada SOAP**, em pelo menos dois pontos do código (`buildSoapRequestOpt` e `httpPost`). Numa instalação real, isso vazaria a senha do certificado A1 pra qualquer sistema de log agregado (Railway logs, Fly.io logs, Sentry, etc).

**@nfewizard/nfce**: 🟡 **Parcial**. Consegui inicializar o logger e entrar no fluxo de `NFE_LoadEnvironment`, mas o processo de validação de configuração (`ValidateEnvironment.checkRequiredSettings`) rejeitou minha config duas vezes com erros diferentes, e ao investigar percebi que:
- O README mostra `new NFCeWizard()` — a classe exportada de verdade é `NFCEWizard` (case diferente).
- O README mostra `nfceWizard.NFCE_LoadEnvironment(...)` — o método de verdade é `NFE_LoadEnvironment` (prefixo diferente).
- O formato exato esperado do objeto de configuração (com ou sem o wrapper `{config: {...}}`) não bateu com o exemplo do README em nenhuma das duas tentativas.

Não consegui, dentro do tempo desta investigação, confirmar se a lib abre nosso `.pfx` dummy com sucesso — o processo falhou antes dessa etapa. Isso não significa que a lib não funcione (o pacote tem estrutura de código limpa e tipos TypeScript completos), mas indica que a documentação pública está **defasada em relação à versão publicada há 1 mês** — um sinal de API ainda instável.

### Tarefa 3 — Cobertura funcional

Ambas as libs, **por leitura direta do código-fonte** (não só documentação):
- Suportam NFC-e modelo 65 explicitamente.
- Suportam cancelamento via evento 110111 com campos `nProt`/`xJust` — **isso valida retroativamente** minha implementação da Fase 1c em `nfceEmissao.service.js`, onde eu tinha inferido exatamente esses mesmos nomes de campo por analogia, sinalizando como "não confirmado". Agora está confirmado por duas fontes independentes.
- Suportam consulta de protocolo/retorno com lógica de polling/retry já embutida.

Nenhuma das duas entrega o retorno já no formato `{cStat, xMotivo, protocolo}` que `nfceEmissao.service.js` espera — ambas exigiriam uma camada de adaptação (extrair esses campos de dentro da resposta própria de cada lib). Isso é esperado e não é um problema grave — é trabalho normal de integração.

### Tarefa 4 — Alternativa paga (só pesquisa)

Consegui acessar `focusnfe.com.br/precos/` com sucesso; `webmania.com.br/planos/` e as páginas de preço da `nfe.io` retornaram **HTTP 403** (bloqueio anti-bot) nas duas tentativas de acesso direto — não inventei números pra elas, só reporto o que achei via busca (resumos, não a tabela exata).

**Focus NFe** (dados exatos, direto da página de preços):
| Plano | Mensalidade | CNPJs | Incluso | Excedente |
|---|---|---|---|---|
| Solo | R$ 89,90 | 1 | 100 notas | R$ 0,10/nota |
| Start | R$ 113,90 | 3 (+R$ 37,90/extra) | 100/CNPJ | R$ 0,10/nota |
| Growth | R$ 548,00 | ilimitado | 4.000 notas | R$ 0,12/nota |
| **Retail** (NFC-e) | R$ 59,90 | 1 | 500 NFC-e + 100 NF-e | R$ 0,05/NFC-e |
| **Retail+** (NFC-e) | R$ 629,90 | **ilimitado** | 9.000 NFC-e + 1.000 NF-e | R$ 0,06/NFC-e |

Isso é **muito relevante pro VIGIA**: sendo multi-tenant, o plano "Retail+" (CNPJs ilimitados, R$629,90/mês pra até 9.000 NFC-e) é o único que escala de forma previsível — os planos "Solo"/"Start"/"Retail" cobram por CNPJ, o que quebraria o modelo de negócio do VIGIA (custo cresceria linearmente com cada supermercado cliente).

**WebmaniaBR**: planos a partir de R$29,90-69,90/mês (não consegui confirmar a tabela exata de CNPJ/nota); indicação de que atende "múltiplos CNPJs" mas sem preço exato por CNPJ confirmado.

**NFE.io**: encontrei (via busca, não a página direta) a alegação de que permite cadastrar vários CNPJs **sem custo extra por CNPJ** — se confirmado diretamente com o vendedor, seria o modelo mais alinhado ao VIGIA. Não consegui validar os valores exatos de mensalidade.

**Recomendo confirmar os números exatos de WebmaniaBR e NFE.io diretamente com o time de vendas deles antes de decidir** — o que tenho aqui é parcial pra essas duas.

---

## 3. Recomendação (dado para você decidir, não decisão minha)

Given o que encontrei, minha leitura é:

- **node-dfe** tecnicamente "funciona" hoje (testei de ponta a ponta até o ponto onde só um certificado real mudaria o resultado) e é MIT, mas carrega um stack de dependências antigo e com vulnerabilidades reais (4 críticas), e **loga a senha do certificado em texto puro** — isso sozinho é um problema sério de segurança pra tratar antes de usar em produção (dá pra mitigar com um fork/patch que remova os `console.log`, mas é manutenção extra que você herda). Maintainer pouco ativo.
- **@nfewizard/nfce** é licença GPL-3.0 (precisa avaliação jurídica antes de mais nada, já que o VIGIA é fechado), tem uma dependência de JDK que complica o Dockerfile de deploy (mesmo com o workaround), e a API mudou o suficiente entre a documentação e a versão publicada pra eu não conseguir validar um fluxo completo no tempo desta investigação — sinal de que precisaria de mais tempo de testes antes de confiar. Em compensação: é ativamente mantida, já fala explicitamente da Reforma Tributária 2025/2026, e tem logging estruturado (melhor prática que o node-dfe nesse ponto).
- O **serviço pago (Focus NFe)**, com o plano "Retail+", parece o caminho de menor risco técnico e jurídico: sem certificado pra gerenciar, sem dependência nativa, sem stack vulnerável, sem questão de licença — só chamadas HTTP. O custo (R$629,90/mês fixo pra até 9.000 NFC-e, ilimitado em CNPJs) precisa ser comparado com quantas notas o VIGIA emitiria de fato somando todos os tenants, e se esse custo é repassável ao cliente final do VIGIA de alguma forma.

Minha inclinação, só como dado técnico — **a decisão final é sua**: dado o achado de segurança grave no node-dfe (senha em log) e a incerteza de licença + API instável do nfewizard, eu daria um peso real à opção do serviço pago (validar WebmaniaBR e NFE.io de verdade com o time de vendas deles, já que Focus NFe tem o modelo de preço mais claro hoje) — mas isso também significa depender de terceiro pra algo fiscal crítico, e envolve custo recorrente que escala com uso. Se a decisão for seguir com biblioteca própria, `node-dfe` está mais perto de funcionar hoje, mas exigiria primeiro resolver o vazamento de log (fork/patch) antes de cogitar produção.

---

## 4. Confirmação de escopo

- Nenhum arquivo em `src/`, `prisma/schema.prisma`, `package.json` (raiz do VIGIA) ou qualquer rota/service/controller existente foi alterado.
- A única coisa criada fora de `/investigacao-libs-nfce` foi `src/tests/fixtures/certificado-teste.pfx` (fixture binário de teste, gerado porque o prompt assumia que já existia e não existia).
- Todo o restante (`spike-node-dfe/`, `spike-nfewizard/`, scripts de teste, `package.json`/`package-lock.json` dos spikes) fica isolado dentro de `/investigacao-libs-nfce`, com `package.json` próprio, não referenciado por nenhum import do app principal.
- Nenhuma decisão foi tomada — isto é levantamento de evidência para você decidir.
