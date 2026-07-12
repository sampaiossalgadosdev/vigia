/**
 * Arquivo: venda-xml.test.js
 * Responsabilidade: Regressão do endpoint de consulta do XML da NFC-e
 * (Fase 1c complemento) — GET /api/vendas/:id/xml, via
 * venda.service.buscarXml.
 * Uso: node --test src/tests/venda-xml.test.js
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
    data: { nome: `Teste Venda XML ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `venda-xml-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId, vendaId, produtoId) {
  if (vendaId) {
    await prisma.vendaPagamento.deleteMany({ where: { vendaId } }).catch(() => {});
    await prisma.vendaItem.deleteMany({ where: { vendaId } }).catch(() => {});
    await prisma.venda.delete({ where: { id: vendaId } }).catch(() => {});
  }
  if (produtoId) await prisma.produto.delete({ where: { id: produtoId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('GET /api/vendas/:id/xml (buscarXml): retorna o XML salvo quando a venda foi emitida', async () => {
  const tenant = await criarTenant('01');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9960000000001', nome: 'Produto XML', preco: 10 } });
  const venda = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 10, total: 10, chaveNfce: '1'.repeat(44), xmlNfce: '<NFe>conteudo de teste</NFe>',
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
    },
  });
  try {
    const resultado = await vendaService.buscarXml(tenant.id, venda.id);
    assert.equal(resultado.vendaId, venda.id);
    assert.equal(resultado.xml, '<NFe>conteudo de teste</NFe>');
    assert.equal(resultado.chaveNfce, '1'.repeat(44));
  } finally {
    await limparTenant(tenant.id, venda.id, produto.id);
  }
});

test('GET /api/vendas/:id/xml: erro claro quando a venda nunca foi emitida (sem xmlNfce)', async () => {
  const tenant = await criarTenant('02');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9960000000002', nome: 'Produto Sem XML', preco: 10 } });
  const venda = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 10, total: 10,
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
    },
  });
  try {
    await assert.rejects(
      () => vendaService.buscarXml(tenant.id, venda.id),
      (erro) => { assert.equal(erro.status, 404); assert.match(erro.message, /não tem XML/); return true; }
    );
  } finally {
    await limparTenant(tenant.id, venda.id, produto.id);
  }
});

test('GET /api/vendas/:id/xml: erro claro quando a venda não existe', async () => {
  const tenant = await criarTenant('03');
  try {
    await assert.rejects(
      () => vendaService.buscarXml(tenant.id, 'id-que-nao-existe'),
      (erro) => { assert.equal(erro.status, 404); assert.match(erro.message, /não encontrada/); return true; }
    );
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

after(async () => {
  await prisma.$disconnect();
});
