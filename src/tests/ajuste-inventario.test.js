/**
 * Arquivo: ajuste-inventario.test.js
 * Responsabilidade: Regressão da Fase 2c — ajuste de estoque manual
 * auditável (MovimentacaoEstoque tipo='ajuste') e processo de inventário
 * (geral/parcial) que reconcilia contagem física via esse mesmo mecanismo.
 * Uso: node --test src/tests/ajuste-inventario.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const loteRepo = require('../repositories/lote.repository');
const ajusteEstoqueService = require('../services/ajusteEstoque.service');
const inventarioService = require('../services/inventario.service');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Ajuste ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `ajuste-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.inventarioItem.deleteMany({ where: { inventario: { tenantId } } }).catch(() => {});
  await prisma.inventario.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.movimentacaoEstoque.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.lote.deleteMany({ where: { estoqueProduto: { produto: { tenantId } } } }).catch(() => {});
  await prisma.estoqueProduto.deleteMany({ where: { produto: { tenantId } } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.categoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.deposito.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('ajusteEstoque: sem motivo (ou só espaços) é rejeitado', async () => {
  const tenant = await criarTenant('01');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000001', nome: 'Produto Sem Motivo', preco: 10, estoqueQtd: 10 } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);

    await assert.rejects(
      () => ajusteEstoqueService.ajusteEstoque(tenant.id, 'usuario-teste', produto.id, deposito.id, 5, '   '),
      (erro) => { assert.match(erro.message, /motivo/i); return true; }
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

test('ajusteEstoque: produto controlaLote=true sem loteId é rejeitado', async () => {
  const tenant = await criarTenant('02');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000002', nome: 'Produto Com Lote', preco: 10, estoqueQtd: 0, controlaLote: true } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);

    await assert.rejects(
      () => ajusteEstoqueService.ajusteEstoque(tenant.id, 'usuario-teste', produto.id, deposito.id, 5, 'Correção de contagem'),
      (erro) => { assert.match(erro.message, /loteId/); return true; }
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

test('ajusteEstoque: produto controlaLote=false com loteId informado é rejeitado', async () => {
  const tenant = await criarTenant('03');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000003', nome: 'Produto Sem Lote', preco: 10, estoqueQtd: 10 } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);

    await assert.rejects(
      () => ajusteEstoqueService.ajusteEstoque(tenant.id, 'usuario-teste', produto.id, deposito.id, 5, 'Correção de contagem', 'algum-lote-id'),
      (erro) => { assert.match(erro.message, /não controla lote/); return true; }
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

test('ajusteEstoque bem-sucedido (sem lote): MovimentacaoEstoque, EstoqueProduto e agregado corretos', async () => {
  const tenant = await criarTenant('04');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000004', nome: 'Produto Ajuste OK', preco: 10, estoqueQtd: 0 } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    await estoqueDepositoRepo.definirQuantidade(prisma, tenant.id, produto.id, deposito.id, 20);

    const movimentacao = await ajusteEstoqueService.ajusteEstoque(tenant.id, 'usuario-teste', produto.id, deposito.id, 15, 'Contagem física mensal');

    assert.equal(movimentacao.tipo, 'ajuste');
    assert.equal(Number(movimentacao.quantidadeAnterior), 20);
    assert.equal(Number(movimentacao.quantidadeNova), 15);
    assert.equal(Number(movimentacao.quantidade), -5);
    assert.equal(movimentacao.origem, 'ajuste_manual');
    assert.equal(movimentacao.depositoId, deposito.id);
    assert.equal(movimentacao.loteId, null);
    assert.equal(movimentacao.observacao, 'Contagem física mensal');

    const estoqueProduto = await prisma.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId: produto.id, depositoId: deposito.id } } });
    assert.equal(Number(estoqueProduto.quantidade), 15);

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 15);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('ajusteEstoque bem-sucedido (com lote): corrige o Lote específico e recalcula o agregado', async () => {
  const tenant = await criarTenant('05');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000005', nome: 'Produto Ajuste Lote', preco: 10, estoqueQtd: 0, controlaLote: true } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    const lote = await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: new Date(Date.now() + 10 * 86400000), quantidade: 10 } });

    const movimentacao = await ajusteEstoqueService.ajusteEstoque(tenant.id, 'usuario-teste', produto.id, deposito.id, 8, 'Contagem física do lote', lote.id);

    assert.equal(Number(movimentacao.quantidadeAnterior), 10);
    assert.equal(Number(movimentacao.quantidadeNova), 8);
    assert.equal(movimentacao.loteId, lote.id);

    const loteDepois = await prisma.lote.findUnique({ where: { id: lote.id } });
    assert.equal(Number(loteDepois.quantidade), 8);
    assert.equal(loteDepois.ativo, true);

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 8, 'agregado deve refletir a soma dos lotes ativos após o ajuste');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('inventário geral: iniciar cria InventarioItem pra todos os produtos do depósito com snapshot correto', async () => {
  const tenant = await criarTenant('06');
  try {
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const p1 = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000006', nome: 'Produto A', preco: 10, estoqueQtd: 0 } });
    const p2 = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000007', nome: 'Produto B', preco: 10, estoqueQtd: 0 } });
    await estoqueDepositoRepo.definirQuantidade(prisma, tenant.id, p1.id, deposito.id, 30);
    await estoqueDepositoRepo.definirQuantidade(prisma, tenant.id, p2.id, deposito.id, 12);

    const inventario = await inventarioService.iniciarInventario(tenant.id, 'usuario-teste', deposito.id, 'geral');

    assert.equal(inventario.status, 'aberto');
    assert.equal(inventario.itens.length, 2);
    const mapa = new Map(inventario.itens.map((i) => [i.produtoId, i]));
    assert.equal(Number(mapa.get(p1.id).quantidadeSistema), 30);
    assert.equal(Number(mapa.get(p2.id).quantidadeSistema), 12);
    assert.equal(mapa.get(p1.id).quantidadeContada, null);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('inventário parcial: só cria InventarioItem pra produtos da categoria filtrada', async () => {
  const tenant = await criarTenant('07');
  try {
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const categoriaA = await prisma.categoria.create({ data: { tenantId: tenant.id, nome: 'Categoria A' } });
    const categoriaB = await prisma.categoria.create({ data: { tenantId: tenant.id, nome: 'Categoria B' } });
    const pA = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000008', nome: 'Produto Categoria A', preco: 10, estoqueQtd: 0, categoriaId: categoriaA.id } });
    const pB = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000009', nome: 'Produto Categoria B', preco: 10, estoqueQtd: 0, categoriaId: categoriaB.id } });
    await estoqueDepositoRepo.definirQuantidade(prisma, tenant.id, pA.id, deposito.id, 5);
    await estoqueDepositoRepo.definirQuantidade(prisma, tenant.id, pB.id, deposito.id, 7);

    const inventario = await inventarioService.iniciarInventario(tenant.id, 'usuario-teste', deposito.id, 'parcial', categoriaA.id);

    assert.equal(inventario.itens.length, 1);
    assert.equal(inventario.itens[0].produtoId, pA.id);
    assert.equal(Number(inventario.itens[0].quantidadeSistema), 5);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('fechar inventário: divergência em produto controlaLote=false gera ajuste automático correto', async () => {
  const tenant = await criarTenant('08');
  try {
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000010', nome: 'Produto Divergente', preco: 10, estoqueQtd: 0 } });
    await estoqueDepositoRepo.definirQuantidade(prisma, tenant.id, produto.id, deposito.id, 50);

    const inventario = await inventarioService.iniciarInventario(tenant.id, 'usuario-teste', deposito.id, 'geral');
    await inventarioService.registrarContagem(tenant.id, inventario.id, produto.id, 46, 'usuario-teste');

    const resultado = await inventarioService.fecharInventario(tenant.id, inventario.id, { id: 'usuario-teste' }, '127.0.0.1');

    assert.equal(resultado.ajustados.length, 1);
    assert.equal(resultado.ajustados[0].produtoId, produto.id);
    assert.equal(resultado.pendentesManuais.length, 0);

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 46);

    const movimentacao = await prisma.movimentacaoEstoque.findFirst({ where: { tenantId: tenant.id, produtoId: produto.id, tipo: 'ajuste' } });
    assert.ok(movimentacao, 'deve gerar MovimentacaoEstoque tipo ajuste');
    assert.equal(movimentacao.origem, 'inventario');
    assert.equal(movimentacao.origemId, inventario.id);
    assert.match(movimentacao.observacao, new RegExp(`Inventário #${inventario.id}`));

    const inventarioDepois = await prisma.inventario.findUnique({ where: { id: inventario.id } });
    assert.equal(inventarioDepois.status, 'fechado');
    assert.ok(inventarioDepois.finalizadoEm);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('fechar inventário: divergência em produto controlaLote=true NÃO ajusta automaticamente, entra na pendência manual', async () => {
  const tenant = await criarTenant('09');
  try {
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000011', nome: 'Produto Lote Divergente', preco: 10, estoqueQtd: 0, controlaLote: true } });
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: new Date(Date.now() + 10 * 86400000), quantidade: 20 } });
    await loteRepo.recalcularEstoqueProdutoDeLotes(prisma, estoqueProduto.id, produto.id);

    const inventario = await inventarioService.iniciarInventario(tenant.id, 'usuario-teste', deposito.id, 'geral');
    await inventarioService.registrarContagem(tenant.id, inventario.id, produto.id, 17, 'usuario-teste');

    const resultado = await inventarioService.fecharInventario(tenant.id, inventario.id, { id: 'usuario-teste' }, '127.0.0.1');

    assert.equal(resultado.ajustados.length, 0);
    assert.equal(resultado.pendentesManuais.length, 1);
    assert.equal(resultado.pendentesManuais[0].produtoId, produto.id);
    assert.equal(Number(resultado.pendentesManuais[0].quantidadeSistema), 20);
    assert.equal(Number(resultado.pendentesManuais[0].quantidadeContada), 17);

    const movimentacoes = await prisma.movimentacaoEstoque.count({ where: { tenantId: tenant.id, produtoId: produto.id, tipo: 'ajuste' } });
    assert.equal(movimentacoes, 0, 'não deve gerar ajuste automático pra produto com lote');

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 20, 'estoque não deve ser tocado — só entra na pendência manual');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('fechar inventário: item não contado não é ajustado e não bloqueia o fechamento', async () => {
  const tenant = await criarTenant('10');
  try {
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const contado = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000012', nome: 'Produto Contado', preco: 10, estoqueQtd: 0 } });
    const naoContado = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000013', nome: 'Produto Não Contado', preco: 10, estoqueQtd: 0 } });
    await estoqueDepositoRepo.definirQuantidade(prisma, tenant.id, contado.id, deposito.id, 10);
    await estoqueDepositoRepo.definirQuantidade(prisma, tenant.id, naoContado.id, deposito.id, 25);

    const inventario = await inventarioService.iniciarInventario(tenant.id, 'usuario-teste', deposito.id, 'geral');
    await inventarioService.registrarContagem(tenant.id, inventario.id, contado.id, 9, 'usuario-teste');

    const resultado = await inventarioService.fecharInventario(tenant.id, inventario.id, { id: 'usuario-teste' }, '127.0.0.1');

    assert.equal(resultado.itensContados, 1);
    assert.equal(resultado.itensNaoContados, 1);
    assert.equal(resultado.ajustados.length, 1);
    assert.equal(resultado.ajustados[0].produtoId, contado.id);

    const naoContadoDepois = await prisma.produto.findUnique({ where: { id: naoContado.id } });
    assert.equal(Number(naoContadoDepois.estoqueQtd), 25, 'produto não contado não deve ser alterado');

    const inventarioDepois = await prisma.inventario.findUnique({ where: { id: inventario.id } });
    assert.equal(inventarioDepois.status, 'fechado', 'fechamento não deve ser bloqueado por itens não contados');
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
