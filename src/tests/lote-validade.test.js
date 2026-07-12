/**
 * Arquivo: lote-validade.test.js
 * Responsabilidade: Regressão da Fase 2b — controle de lote/validade
 * opcional por produto (Produto.controlaLote).
 * Cobre: regressão de produto sem controlaLote (venda e confirmação de NF-e
 * idênticas à Fase 2a), consumo FIFO na venda, bloqueio de venda com lote
 * vencido, bloqueio de confirmação de NF-e sem validade informada, alertas
 * de vencimento agrupados por urgência e geração de promoção relâmpago.
 * Uso: node --test src/tests/lote-validade.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const estoqueService = require('../services/estoque.service');
const vendaService = require('../services/venda.service');
const { backfillTenant } = require('../scripts/migrarDepositos');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Lote ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `lote-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.lote.deleteMany({ where: { estoqueProduto: { produto: { tenantId } } } }).catch(() => {});
  await prisma.movimentacaoEstoque.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.vendaPagamento.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.vendaItem.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.venda.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.promocao.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.nfeItem.deleteMany({ where: { nfe: { tenantId } } }).catch(() => {});
  await prisma.nfe.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.estoqueProduto.deleteMany({ where: { produto: { tenantId } } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.deposito.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

function diasAPartirDeAgora(dias) {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}

test('regressão: produto com controlaLote=false continua vendendo e confirmando NF-e exatamente como na Fase 2a (sem Lote)', async () => {
  const tenant = await criarTenant('01');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9910000000001', nome: 'Produto Sem Lote', preco: 10, estoqueQtd: 10 } });
    await backfillTenant(tenant.id);
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 4 }], pagamentos: [{ forma: 'dinheiro', valor: 40 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );
    assert.ok(venda.id);
    const apósVenda = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(apósVenda.estoqueQtd), 6, 'venda decrementa o agregado diretamente, sem Lote');

    const fornecedor = await prisma.fornecedor.create({ data: { tenantId: tenant.id, nome: 'Fornecedor Teste', cnpj: cnpjTeste('91') } });
    const nfe = await prisma.nfe.create({
      data: {
        tenantId: tenant.id, fornecedorId: fornecedor.id, numeroNfe: '1',
        chaveAcesso: `chave-lote-teste-${Date.now()}-01`, dataEmissao: new Date(), valorTotal: 50,
        xmlOriginal: '<xml>teste</xml>', status: 'pendente',
        itens: { create: [{ descricao: 'Item NFe', ean: produto.ean, unidade: 'UN', quantidade: 5, valorUnitario: 10, valorTotal: 50, status: 'ok', produtoId: produto.id, fatorConversao: 1 }] },
      },
      include: { itens: true },
    });

    // Sem lotesPorItem — deve confirmar normalmente, pois controlaLote=false.
    const confirmada = await estoqueService.confirmarNfe(tenant.id, nfe.id, { id: 'usuario-teste' }, '127.0.0.1');
    assert.equal(confirmada.status, 'confirmada');

    const apósNfe = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(apósNfe.estoqueQtd), 11, 'confirmação de NF-e incrementa o agregado diretamente (6 + 5)');

    const lotesCriados = await prisma.lote.count({ where: { estoqueProduto: { produtoId: produto.id } } });
    assert.equal(lotesCriados, 0, 'produto sem controlaLote nunca deve gerar linhas de Lote');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('venda com controlaLote=true: consome o lote mais antigo primeiro e, se a venda exceder o mais antigo, consome o excedente do próximo', async () => {
  const tenant = await criarTenant('02');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9920000000001', nome: 'Produto Dois Lotes', preco: 10, estoqueQtd: 0, controlaLote: true } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    const loteAntigo = await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, numeroLote: 'ANTIGO', dataValidade: diasAPartirDeAgora(2), quantidade: 5 } });
    const loteNovo = await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, numeroLote: 'NOVO', dataValidade: diasAPartirDeAgora(30), quantidade: 10 } });

    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 8 }], pagamentos: [{ forma: 'dinheiro', valor: 80 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );
    assert.ok(venda.id);

    const loteAntigoDepois = await prisma.lote.findUnique({ where: { id: loteAntigo.id } });
    assert.equal(Number(loteAntigoDepois.quantidade), 0, 'lote mais antigo deve ser totalmente consumido primeiro');
    assert.equal(loteAntigoDepois.ativo, false, 'lote esgotado fica inativo');

    const loteNovoDepois = await prisma.lote.findUnique({ where: { id: loteNovo.id } });
    assert.equal(Number(loteNovoDepois.quantidade), 7, 'excedente (8 - 5 = 3) deve ser consumido do lote seguinte (10 - 3 = 7)');
    assert.equal(loteNovoDepois.ativo, true);

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 7, 'estoqueQtd deve refletir a soma dos lotes ativos (0 + 7)');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('venda com controlaLote=true: lote vencido bloqueia a venda com erro claro, sem alterar o estoque', async () => {
  const tenant = await criarTenant('03');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9930000000001', nome: 'Produto Lote Vencido', preco: 10, estoqueQtd: 5, controlaLote: true } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    await prisma.estoqueProduto.update({ where: { id: estoqueProduto.id }, data: { quantidade: 5 } });
    const lote = await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, numeroLote: 'VENCIDO', dataValidade: diasAPartirDeAgora(-3), quantidade: 5 } });

    await assert.rejects(
      () => vendaService.registrar(
        tenant.id,
        { itens: [{ produtoId: produto.id, quantidade: 2 }], pagamentos: [{ forma: 'dinheiro', valor: 20 }] },
        { id: 'usuario-teste' },
        '127.0.0.1'
      ),
      (erro) => {
        assert.match(erro.message, /Produto Lote Vencido possui lote vencido em .* venda bloqueada/);
        return true;
      }
    );

    const loteDepois = await prisma.lote.findUnique({ where: { id: lote.id } });
    assert.equal(Number(loteDepois.quantidade), 5, 'quantidade do lote vencido não deve mudar quando a venda é bloqueada');
    assert.equal(loteDepois.ativo, true);

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 5, 'estoqueQtd não deve mudar quando a venda é bloqueada');

    const vendasCriadas = await prisma.venda.count({ where: { tenantId: tenant.id } });
    assert.equal(vendasCriadas, 0, 'nenhuma venda deve ser persistida (rollback da transação)');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('confirmação de NF-e: produto com controlaLote=true sem informar validade é bloqueada; informando, cria o Lote corretamente', async () => {
  const tenant = await criarTenant('04');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9940000000001', nome: 'Produto NFe Lote', preco: 10, custoMedio: 5, estoqueQtd: 0, controlaLote: true } });
    const fornecedor = await prisma.fornecedor.create({ data: { tenantId: tenant.id, nome: 'Fornecedor Teste', cnpj: cnpjTeste('94') } });
    const nfe = await prisma.nfe.create({
      data: {
        tenantId: tenant.id, fornecedorId: fornecedor.id, numeroNfe: '1',
        chaveAcesso: `chave-lote-teste-${Date.now()}-04`, dataEmissao: new Date(), valorTotal: 60,
        xmlOriginal: '<xml>teste</xml>', status: 'pendente',
        itens: { create: [{ descricao: 'Item NFe Lote', ean: produto.ean, unidade: 'UN', quantidade: 6, valorUnitario: 10, valorTotal: 60, status: 'ok', produtoId: produto.id, fatorConversao: 1 }] },
      },
      include: { itens: true },
    });

    // Sem informar lote/validade — deve bloquear ANTES de abrir a transação.
    await assert.rejects(
      () => estoqueService.confirmarNfe(tenant.id, nfe.id, { id: 'usuario-teste' }, '127.0.0.1', {}),
      (erro) => {
        assert.match(erro.message, /controla lote\/validade — informe a validade do lote/);
        return true;
      }
    );

    const nfeDepois = await prisma.nfe.findUnique({ where: { id: nfe.id } });
    assert.equal(nfeDepois.status, 'pendente', 'NF-e não deve ser confirmada quando o lote obrigatório não é informado');
    const produtoAposBloqueio = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoAposBloqueio.estoqueQtd), 0, 'estoque não deve mudar quando a confirmação é bloqueada');

    // Agora informando lote/validade — confirma normalmente e cria o Lote.
    const item = nfe.itens[0];
    const validade = diasAPartirDeAgora(45).toISOString().slice(0, 10);
    const confirmada = await estoqueService.confirmarNfe(tenant.id, nfe.id, { id: 'usuario-teste' }, '127.0.0.1', {
      [item.id]: { numeroLote: 'L-001', dataValidade: validade },
    });
    assert.equal(confirmada.status, 'confirmada');

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 6, 'estoqueQtd deve refletir a entrada do lote recém-criado');

    const deposito = await prisma.deposito.findFirst({ where: { tenantId: tenant.id, principal: true } });
    const estoqueProduto = await prisma.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId: produto.id, depositoId: deposito.id } } });
    const lotes = await prisma.lote.findMany({ where: { estoqueProdutoId: estoqueProduto.id } });
    assert.equal(lotes.length, 1, 'deve criar exatamente uma linha de Lote para a entrada');
    assert.equal(lotes[0].numeroLote, 'L-001');
    assert.equal(Number(lotes[0].quantidade), 6);
    assert.equal(lotes[0].ativo, true);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('GET alertas de validade: agrupa lotes ativos em vencido, crítico (até 3 dias) e atenção (até 7 dias)', async () => {
  const tenant = await criarTenant('05');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9950000000001', nome: 'Produto Alertas', preco: 10, estoqueQtd: 0, controlaLote: true } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);

    const loteVencido = await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(-1), quantidade: 3 } });
    const loteCritico = await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(2), quantidade: 4 } });
    const loteAtencao = await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(6), quantidade: 5 } });

    const grupos = await estoqueService.alertasValidade(tenant.id, 7);

    assert.equal(grupos.vencido.length, 1);
    assert.equal(grupos.vencido[0].loteId, loteVencido.id);
    assert.equal(grupos.critico.length, 1);
    assert.equal(grupos.critico[0].loteId, loteCritico.id);
    assert.equal(grupos.atencao.length, 1);
    assert.equal(grupos.atencao[0].loteId, loteAtencao.id);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('promoção relâmpago: produto sem promoção ativa e lote vencendo em breve gera promoção; produto com promoção ativa entra na lista de revisão manual', async () => {
  const tenant = await criarTenant('06');
  try {
    const produtoSemPromo = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9960000000001', nome: 'Produto Sem Promo', preco: 10, estoqueQtd: 0, controlaLote: true } });
    const produtoComPromo = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9960000000002', nome: 'Produto Com Promo', preco: 20, estoqueQtd: 0, controlaLote: true } });

    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueSemPromo = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produtoSemPromo.id, deposito.id);
    const estoqueComPromo = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produtoComPromo.id, deposito.id);

    await prisma.lote.create({ data: { estoqueProdutoId: estoqueSemPromo.id, dataValidade: diasAPartirDeAgora(3), quantidade: 10 } });
    await prisma.lote.create({ data: { estoqueProdutoId: estoqueComPromo.id, dataValidade: diasAPartirDeAgora(2), quantidade: 8 } });

    const promocaoExistente = await prisma.promocao.create({
      data: {
        tenantId: tenant.id, produtoId: produtoComPromo.id, nome: 'Promoção manual já ativa',
        tipo: 'percentual', desconto: 10, dataInicio: new Date(), dataFim: diasAPartirDeAgora(10),
      },
    });

    const resultado = await estoqueService.gerarPromocoesRelampago(tenant.id, { id: 'usuario-teste' }, '127.0.0.1', 5);

    assert.equal(resultado.criadas.length, 1, 'deve criar promoção só pro produto sem promoção ativa');
    assert.equal(resultado.criadas[0].produtoId, produtoSemPromo.id);
    assert.equal(Number(resultado.criadas[0].desconto), 20);
    assert.equal(resultado.criadas[0].tipo, 'percentual');

    assert.equal(resultado.jaTemPromocaoAtiva.length, 1, 'produto com promoção ativa não deve ser duplicado — entra na lista de revisão manual');
    assert.equal(resultado.jaTemPromocaoAtiva[0].produtoId, produtoComPromo.id);
    assert.equal(resultado.jaTemPromocaoAtiva[0].promocaoId, promocaoExistente.id);

    const promocoesDoComPromo = await prisma.promocao.count({ where: { tenantId: tenant.id, produtoId: produtoComPromo.id } });
    assert.equal(promocoesDoComPromo, 1, 'não deve duplicar a promoção existente');
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
