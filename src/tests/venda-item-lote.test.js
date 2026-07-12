/**
 * Arquivo: venda-item-lote.test.js
 * Responsabilidade: Regressão do complemento da Fase 2b — rastreio de qual
 * Lote cada VendaItem consumiu (VendaItemLote), usado pra devolver certo no
 * cancelamento de venda (em vez de só ajustar o agregado, quebrando a
 * invariante agregado = soma dos lotes ativos).
 * Uso: node --test src/tests/venda-item-lote.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const vendaService = require('../services/venda.service');
const logger = require('../logs/logger');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste VendaItemLote ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `venda-item-lote-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.vendaItemLote.deleteMany({ where: { vendaItem: { venda: { tenantId } } } }).catch(() => {});
  await prisma.lote.deleteMany({ where: { estoqueProduto: { produto: { tenantId } } } }).catch(() => {});
  await prisma.movimentacaoEstoque.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.vendaPagamento.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.vendaItem.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.venda.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.promocao.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.estoqueProduto.deleteMany({ where: { produto: { tenantId } } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.deposito.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

function diasAPartirDeAgora(dias) {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}

test('cancelamento: venda que consumiu de um único lote devolve exatamente a esse lote, e o agregado bate com a soma dos lotes', async () => {
  const tenant = await criarTenant('01');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000001', nome: 'Produto Um Lote', preco: 10, estoqueQtd: 0, controlaLote: true } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    const lote = await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(10), quantidade: 10 } });

    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 4 }], pagamentos: [{ forma: 'dinheiro', valor: 40 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );

    const loteAposVenda = await prisma.lote.findUnique({ where: { id: lote.id } });
    assert.equal(Number(loteAposVenda.quantidade), 6, 'venda deve consumir 4 do único lote (10 - 4)');

    const vendaItem = (await prisma.vendaItem.findMany({ where: { vendaId: venda.id } }))[0];
    const consumos = await prisma.vendaItemLote.findMany({ where: { vendaItemId: vendaItem.id } });
    assert.equal(consumos.length, 1);
    assert.equal(consumos[0].loteId, lote.id);
    assert.equal(Number(consumos[0].quantidade), 4);

    await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'teste de cancelamento', '127.0.0.1');

    const loteAposCancelamento = await prisma.lote.findUnique({ where: { id: lote.id } });
    assert.equal(Number(loteAposCancelamento.quantidade), 10, 'cancelamento deve devolver os 4 exatamente a este lote (6 + 4)');
    assert.equal(loteAposCancelamento.ativo, true);

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 10, 'agregado deve bater com a soma dos lotes ativos após o cancelamento');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('cancelamento: venda que espirrou por DOIS lotes devolve a quantidade certa a cada um, proporcional ao que cada lote forneceu', async () => {
  const tenant = await criarTenant('02');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000002', nome: 'Produto Dois Lotes', preco: 10, estoqueQtd: 0, controlaLote: true } });
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

    const vendaItem = (await prisma.vendaItem.findMany({ where: { vendaId: venda.id } }))[0];
    const consumos = await prisma.vendaItemLote.findMany({ where: { vendaItemId: vendaItem.id }, orderBy: { quantidade: 'desc' } });
    assert.equal(consumos.length, 2, 'deve registrar rastreio dos DOIS lotes tocados pelo FIFO');
    const consumoAntigo = consumos.find((c) => c.loteId === loteAntigo.id);
    const consumoNovo = consumos.find((c) => c.loteId === loteNovo.id);
    assert.equal(Number(consumoAntigo.quantidade), 5, 'lote mais antigo forneceu 5 (tudo que tinha)');
    assert.equal(Number(consumoNovo.quantidade), 3, 'lote mais novo forneceu o excedente (8 - 5 = 3)');

    await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'teste de cancelamento', '127.0.0.1');

    const loteAntigoDepois = await prisma.lote.findUnique({ where: { id: loteAntigo.id } });
    assert.equal(Number(loteAntigoDepois.quantidade), 5, 'lote mais antigo recebe de volta exatamente os 5 que forneceu');
    assert.equal(loteAntigoDepois.ativo, true, 'lote que tinha zerado (ativo=false) deve ser reativado ao receber devolução');

    const loteNovoDepois = await prisma.lote.findUnique({ where: { id: loteNovo.id } });
    assert.equal(Number(loteNovoDepois.quantidade), 10, 'lote mais novo recebe de volta exatamente os 3 que forneceu (7 + 3)');

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 15, 'agregado deve bater com a soma dos dois lotes (5 + 10)');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('cancelamento: lote de origem já zerado por outra operação posterior (ativo=false) é reativado corretamente pela devolução', async () => {
  const tenant = await criarTenant('03');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000003', nome: 'Produto Lote Reativado', preco: 10, estoqueQtd: 0, controlaLote: true } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    const lote = await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(10), quantidade: 10 } });

    // Venda 1: consome 3 do lote (fica com 7, ainda ativo).
    const venda1 = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 3 }], pagamentos: [{ forma: 'dinheiro', valor: 30 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );

    // Venda 2 ("outra operação depois"): consome o restante (7), zerando e desativando o lote.
    await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 7 }], pagamentos: [{ forma: 'dinheiro', valor: 70 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );

    const loteZerado = await prisma.lote.findUnique({ where: { id: lote.id } });
    assert.equal(Number(loteZerado.quantidade), 0);
    assert.equal(loteZerado.ativo, false, 'lote deve estar zerado e inativo antes do cancelamento');

    // Cancela a Venda 1 (a mais antiga) — deve devolver 3 ao lote e reativá-lo.
    await vendaService.cancelar(tenant.id, venda1.id, { id: 'usuario-teste' }, 'teste de reativação', '127.0.0.1');

    const loteReativado = await prisma.lote.findUnique({ where: { id: lote.id } });
    assert.equal(Number(loteReativado.quantidade), 3, 'deve devolver exatamente os 3 consumidos pela Venda 1');
    assert.equal(loteReativado.ativo, true, 'lote deve ser reativado mesmo tendo sido zerado por operação posterior');

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 3, 'agregado deve refletir o lote reativado com 3 unidades');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('cancelamento: venda "antiga" sem VendaItemLote cai no fallback (devolve só ao agregado) e gera log de aviso, sem lançar erro', async () => {
  const tenant = await criarTenant('04');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000004', nome: 'Produto Legado', preco: 10, estoqueQtd: 0, controlaLote: true } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(10), quantidade: 10 } });
    await prisma.estoqueProduto.update({ where: { id: estoqueProduto.id }, data: { quantidade: 10 } });
    await prisma.produto.update({ where: { id: produto.id }, data: { estoqueQtd: 10 } });

    // Simula uma venda registrada ANTES deste rastreio existir: cria Venda/VendaItem
    // direto no banco (sem passar por vendaService.registrar) e decrementa o
    // agregado manualmente, sem gerar nenhum VendaItemLote.
    const venda = await prisma.venda.create({
      data: {
        tenantId: tenant.id, subtotal: 40, total: 40,
        itens: { create: [{ produtoId: produto.id, quantidade: 4, precoUnitario: 10, custoUnitario: 5, subtotal: 40, total: 40 }] },
      },
      include: { itens: true },
    });
    await prisma.estoqueProduto.update({ where: { id: estoqueProduto.id }, data: { quantidade: { decrement: 4 } } });
    await prisma.produto.update({ where: { id: produto.id }, data: { estoqueQtd: { decrement: 4 } } });

    const avisos = [];
    const warnOriginal = logger.warn;
    logger.warn = (...args) => { avisos.push(args); };
    let resultado;
    try {
      resultado = await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'teste sem rastreio', '127.0.0.1');
    } finally {
      logger.warn = warnOriginal;
    }

    assert.equal(resultado.cancelada, true, 'cancelamento não deve lançar erro por falta de rastreio');
    assert.equal(avisos.length, 1, 'deve gerar exatamente um log de aviso pro item sem VendaItemLote');
    assert.match(avisos[0][0], /sem rastreio de lote/);

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 10, 'fallback devolve só ao agregado (6 + 4 = 10)');

    const lote = await prisma.lote.findFirst({ where: { estoqueProdutoId: estoqueProduto.id } });
    assert.equal(Number(lote.quantidade), 10, 'o Lote em si não é tocado pelo fallback — limitação conhecida (agregado diverge da soma dos lotes)');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('regressão: produto com controlaLote=false — venda e cancelamento continuam idênticos à Fase 2a, sem nenhum VendaItemLote', async () => {
  const tenant = await criarTenant('05');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000005', nome: 'Produto Sem Lote', preco: 10, estoqueQtd: 10 } });
    await estoqueDepositoRepo.definirEstoquePrincipal(prisma, tenant.id, produto.id, 10);
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 4 }], pagamentos: [{ forma: 'dinheiro', valor: 40 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );
    const apósVenda = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(apósVenda.estoqueQtd), 6);

    const vendaItem = (await prisma.vendaItem.findMany({ where: { vendaId: venda.id } }))[0];
    const consumos = await prisma.vendaItemLote.findMany({ where: { vendaItemId: vendaItem.id } });
    assert.equal(consumos.length, 0, 'produto sem controlaLote nunca deve gerar VendaItemLote');

    await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'teste de cancelamento', '127.0.0.1');

    const apósCancelamento = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(apósCancelamento.estoqueQtd), 10, 'cancelamento devolve ao agregado exatamente como na Fase 2a');
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
