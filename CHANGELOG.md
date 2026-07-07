# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [1.0.0] — Parte 1 (retaguarda + superadmin + rede)

### Adicionado
- Estrutura Express em camadas: Route → Middleware → Controller → Service → Repository → Prisma.
- Schema Prisma completo: Superadmin, Superusuario, SuperusuarioTenant, Tenant, RefreshToken, Usuario, Categoria, Produto, Fornecedor, Nfe, NfeItem, MovimentacaoEstoque, Sugestao, Auditoria, DecisaoIA.
- Autenticação em 3 contextos (tenant com refresh rotacionado, superadmin, superusuário de rede) com segredos JWT independentes.
- CRUD de produtos com EAN único por tenant, PLU obrigatório para itens por peso, soft delete e alertas de estoque mínimo.
- CRUD de fornecedores com validação de dígitos verificadores de CNPJ (backend e frontend).
- Entrada de estoque por XML de NF-e: parse, casamento por EAN, fornecedor automático, confirmação transacional com custo médio ponderado, itens pendentes com vinculação posterior (retroativa se a nota já foi confirmada).
- Importação de produtos em lote (CSV/XLSX) em 2 etapas com preview validado e token com TTL de 10 minutos; modelo.xlsx para download.
- Gestão de usuários do tenant com perfis dono/gerente/operador e permissões por rota.
- Sugestões: superusuário envia para lojas; tenant vê no dashboard com badge e marca como lida/arquivada.
- Painel superadmin: tenants (criar com dono inicial, planos, suspender/reativar, stats), superusuários e vínculos com lojas, importação de produtos por tenant.
- Painel de rede: cards por loja, métricas detalhadas (KPIs, gráfico 30 dias, histórico 6 meses, top 10, rupturas) e comparativo mensal entre lojas com ranking — Chart.js.
- Endpoint `GET /api/produtos/sync?desde=` preparado para a sincronização do PDV (Parte 2).
- Auditoria de eventos de negócio com antes/depois e IP; logs de requisição com Winston.
- Seed completo: superadmin, superusuário com 2 lojas, 2 tenants com equipes, produtos, fornecedores, categorias, movimentações e sugestões.
- Documentação: README (instalação, credenciais, deploy Railway), ARQUITETURA e este CHANGELOG.

### Observações
- Faturamento do painel de rede é estimado por saídas de estoque × preço atual (sem PDV na Parte 1).

## [2.0.0] — Parte 2

### Adicionado
- Módulo de vendas com registro, cancelamento e sincronização offline
- Módulo de promoções com validação de conflito
- Módulo de caixa com abertura, fechamento, sangria e suprimento
- Relatórios: vendas, margem, giro, DRE simplificado, estoque crítico
- Sincronização com PDV Electron (produtos, promoções, vendas offline)
- Sugestões de IA via Claude API baseadas em histórico de decisões
- Novas páginas: vendas, promoções, caixa, relatórios, IA
