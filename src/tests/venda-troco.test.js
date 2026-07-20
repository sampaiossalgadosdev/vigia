/**
 * Arquivo: venda-troco.test.js
 * Responsabilidade: Regressão de venda.service.registrar()/sync() para o
 * campo `troco` (achado de revisão 2026-07-19/20, pesquisa NT 2016.002/
 * regra YA09-10 — ver nfceXml.test.js pro lado do XML).
 * `body.troco` é lido DIRETO do client (igual a body.desconto), nunca mais
 * derivado de `totalPagamentos - total` — a derivação antiga sempre dava 0
 * porque VendaPagamento.valor é (e continua sendo) o valor LÍQUIDO de cada
 * pagamento, nunca o tenderizado (ver comentário em venda.service.js,
 * dentro de registrar()). Este arquivo prova especificamente que aceitar
 * troco NÃO infla VendaPagamento.valor nem Caixa.totalDinheiro — é a
 * garantia central desta mudança (conferida por leitura de código ANTES de
 * implementar: um desenho alternativo, onde o dinheiro viria com o valor
 * tenderizado, quebraria as duas contas).
 * Uso: node --test src/tests/venda-troco.test.js
 * Depende de: DATABASE_URL válido em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const vendaService = require('../services/venda.service');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Troco ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `troco-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.vendaPagamento.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.vendaItem.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.venda.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('registrar(): sem troco (padrão, comportamento de sempre) — Venda.troco=0, VendaPagamento.valor igual ao total', async () => {
  const tenant = await criarTenant('01');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000001', nome: 'Produto Troco 01', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  try {
    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 10 }] },
      { id: 'usuario-teste' }, '127.0.0.1'
    );
    assert.equal(Number(venda.troco), 0);
    const pagamento = await prisma.vendaPagamento.findFirst({ where: { vendaId: venda.id } });
    assert.equal(Number(pagamento.valor), 10);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('registrar(): troco negativo é rejeitado com erro claro, sem persistir a venda', async () => {
  const tenant = await criarTenant('02');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000002', nome: 'Produto Troco 02', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  try {
    await assert.rejects(
      () => vendaService.registrar(
        tenant.id,
        { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 10 }], troco: -5 },
        { id: 'usuario-teste' }, '127.0.0.1'
      ),
      (erro) => { assert.equal(erro.status, 422); assert.match(erro.message, /Troco não pode ser negativo/); return true; }
    );
    const count = await prisma.venda.count({ where: { tenantId: tenant.id } });
    assert.equal(count, 0, 'nenhuma venda deve ser persistida quando o troco é inválido');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('registrar(): troco > 0 sem pagamento em dinheiro (ex: só crédito) é rejeitado — troco não faz sentido fora de dinheiro neste sistema', async () => {
  const tenant = await criarTenant('03');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000003', nome: 'Produto Troco 03', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  try {
    await assert.rejects(
      () => vendaService.registrar(
        tenant.id,
        { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'credito', valor: 10 }], troco: 5 },
        { id: 'usuario-teste' }, '127.0.0.1'
      ),
      (erro) => { assert.equal(erro.status, 422); assert.match(erro.message, /Troco só é válido quando há pagamento em dinheiro/); return true; }
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

test('registrar(): troco > 0 com pagamento em dinheiro é aceito — Venda.troco bate com o enviado, VendaPagamento.valor continua LÍQUIDO (não tenderizado), Caixa.totalDinheiro reflete o líquido', async () => {
  const tenant = await criarTenant('04');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000004', nome: 'Produto Troco 04', preco: 27.9 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  try {
    // Cliente pagou 35,90 por uma compra de 27,90 — 8,00 de troco. O client
    // (Pagamento.jsx) manda pagamentos[].valor = 27.90 (líquido) + troco=8
    // separado, NUNCA pagamentos[].valor = 35.90 (ver header do arquivo).
    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 27.9 }], troco: 8 },
      { id: 'usuario-teste' }, '127.0.0.1'
    );
    assert.equal(Number(venda.troco), 8);
    assert.equal(Number(venda.total), 27.9);

    const pagamento = await prisma.vendaPagamento.findFirst({ where: { vendaId: venda.id } });
    assert.equal(Number(pagamento.valor), 27.9, 'VendaPagamento.valor deve continuar líquido — nunca 35.90 (tenderizado)');

    const caixa = await prisma.caixa.findFirst({ where: { tenantId: tenant.id } });
    assert.equal(Number(caixa.totalDinheiro), 27.9, 'Caixa.totalDinheiro não pode ser inflado pelo troco — é a garantia central desta mudança');
    assert.equal(Number(caixa.totalVendas), 27.9);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('sync(): troco também funciona pelo caminho de sync (não precisa de opcoes-gating, igual a desconto)', async () => {
  const tenant = await criarTenant('05');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000005', nome: 'Produto Troco 05', preco: 20 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const localId = 'local-troco-05';
  try {
    const resultados = await vendaService.sync(tenant.id, [
      { localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 20 }], troco: 30 },
    ]);
    assert.equal(resultados[0].status, 'ok');

    const venda = await prisma.venda.findFirst({ where: { tenantId: tenant.id, localId } });
    assert.equal(Number(venda.troco), 30);
    const pagamento = await prisma.vendaPagamento.findFirst({ where: { vendaId: venda.id } });
    assert.equal(Number(pagamento.valor), 20, 'valor líquido preservado também no caminho de sync');
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
