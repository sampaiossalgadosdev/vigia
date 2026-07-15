/**
 * Arquivo: pdv-snapshot.test.js
 * Responsabilidade: Regressão da Fase 3a — GET /api/pdv/snapshot.
 * Cobre: escopo por tenant (um tenant nunca recebe produto/estoque/lote de
 * outro), presença de preço/estoque/lote no formato esperado e a premissa
 * de assumir o Depósito Principal do tenant.
 * Uso: node --test src/tests/pdv-snapshot.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const pdvSnapshotService = require('../services/pdvSnapshot.service');
const { backfillTenant } = require('../scripts/migrarDepositos');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Snapshot PDV ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `snapshot-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.lote.deleteMany({ where: { estoqueProduto: { produto: { tenantId } } } }).catch(() => {});
  await prisma.estoqueProduto.deleteMany({ where: { produto: { tenantId } } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.deposito.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('snapshot: retorna produto, preço, estoque e permiteEstoqueNegativo do Depósito Principal', async () => {
  const tenant = await criarTenant('01');
  try {
    const produto = await prisma.produto.create({
      data: { tenantId: tenant.id, ean: '9700000000001', codigoReferencia: 'REF-001', unidade: 'CX', nome: 'Produto Snapshot', preco: 12.5, estoqueQtd: 20 },
    });
    await backfillTenant(tenant.id);
    const deposito = await prisma.deposito.findFirst({ where: { tenantId: tenant.id, principal: true } });
    await prisma.estoqueProduto.update({
      where: { produtoId_depositoId: { produtoId: produto.id, depositoId: deposito.id } },
      data: { permiteEstoqueNegativo: false },
    });

    const snapshot = await pdvSnapshotService.montar(tenant.id);

    assert.equal(snapshot.depositoId, deposito.id, 'snapshot deve assumir o Depósito Principal do tenant');
    assert.equal(snapshot.produtos.length, 1);
    const [p] = snapshot.produtos;
    assert.equal(p.id, produto.id);
    assert.equal(p.precoVenda, 12.5);
    assert.equal(p.codigoReferencia, 'REF-001', 'snapshot deve trazer codigoReferencia (Fase 3b: busca local por código de referência)');
    assert.equal(p.unidade, 'CX', 'snapshot deve trazer unidade');
    assert.equal(p.ativo, true, 'snapshot deve trazer ativo (Fase 3b: busca local não pode sugerir produto inativo)');
    assert.equal(p.permiteEstoqueNegativo, false, 'permiteEstoqueNegativo deve vir do EstoqueProduto do Depósito Principal');
    assert.ok(p.origemVersao, 'produto deve trazer campo de versão (origemVersao)');

    assert.equal(snapshot.estoque.length, 1);
    assert.equal(snapshot.estoque[0].quantidade, 20);
    assert.ok(snapshot.estoque[0].atualizadoEm, 'estoque deve trazer campo de versão (atualizadoEm)');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('snapshot: inclui lotes ativos do produto com controlaLote=true', async () => {
  const tenant = await criarTenant('02');
  try {
    const produto = await prisma.produto.create({
      data: { tenantId: tenant.id, ean: '9700000000002', nome: 'Produto Com Lote', preco: 8, controlaLote: true },
    });
    const deposito = await prisma.deposito.create({ data: { tenantId: tenant.id, nome: 'Depósito Principal', principal: true } });
    const estoqueProduto = await prisma.estoqueProduto.create({ data: { produtoId: produto.id, depositoId: deposito.id, quantidade: 10 } });
    await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: new Date(Date.now() + 86400000 * 30), quantidade: 10 } });

    const snapshot = await pdvSnapshotService.montar(tenant.id);
    assert.equal(snapshot.lotes.length, 1);
    assert.equal(snapshot.lotes[0].produtoId, produto.id);
    assert.equal(snapshot.lotes[0].quantidade, 10);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('snapshot: escopo por tenant — tenant A nunca recebe produto/estoque/lote do tenant B', async () => {
  const tenantA = await criarTenant('03');
  const tenantB = await criarTenant('04');
  try {
    const produtoA = await prisma.produto.create({ data: { tenantId: tenantA.id, ean: '9700000000003', nome: 'Produto A', preco: 5, estoqueQtd: 3 } });
    const produtoB = await prisma.produto.create({ data: { tenantId: tenantB.id, ean: '9700000000004', nome: 'Produto B', preco: 7, estoqueQtd: 9 } });
    await backfillTenant(tenantA.id);
    await backfillTenant(tenantB.id);

    const snapshotA = await pdvSnapshotService.montar(tenantA.id);
    const snapshotB = await pdvSnapshotService.montar(tenantB.id);

    assert.equal(snapshotA.produtos.length, 1);
    assert.equal(snapshotA.produtos[0].id, produtoA.id);
    assert.ok(!snapshotA.produtos.some((p) => p.id === produtoB.id), 'snapshot do tenant A não pode conter produto do tenant B');
    assert.notEqual(snapshotA.depositoId, snapshotB.depositoId, 'cada tenant deve ter seu próprio Depósito Principal');

    assert.equal(snapshotB.produtos.length, 1);
    assert.equal(snapshotB.produtos[0].id, produtoB.id);
    assert.ok(!snapshotB.produtos.some((p) => p.id === produtoA.id), 'snapshot do tenant B não pode conter produto do tenant A');
  } finally {
    await limparTenant(tenantA.id);
    await limparTenant(tenantB.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
