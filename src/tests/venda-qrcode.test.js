/**
 * Arquivo: venda-qrcode.test.js
 * Responsabilidade: Regressão do endpoint de consulta da URL do QR Code
 * pra imprimir o DANFE — GET /api/vendas/:id/qrcode, via
 * venda.service.buscarQrCode. Endpoint SEPARADO de registrar() de
 * propósito (ver nota no service): montar a URL depende do CSC e pode
 * falhar sem que isso derrube a venda já registrada.
 * Uso: node --test src/tests/venda-qrcode.test.js
 * Depende de: DATABASE_URL válido em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const prisma = require('../config/database');
const vendaService = require('../services/venda.service');
const { criptografarTexto } = require('../utils/certcrypto');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo, dadosExtras = {}) {
  return prisma.tenant.create({
    data: { nome: `Teste QR Code ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `venda-qrcode-${sufixo}-${Date.now()}@teste.com`, ...dadosExtras },
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

test('GET /api/vendas/:id/qrcode: monta a URL corretamente (hash SHA-1 confere com cálculo manual) quando o tenant tem CSC do ambiente atual configurado', async () => {
  const tenant = await criarTenant('01', {
    uf: 'PR', ambienteFiscal: 'homologacao',
    cscHomologacao: criptografarTexto('CSCFAKE1234567890'), cscHomologacaoId: '1',
  });
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000001', nome: 'Produto QR', preco: 10 } });
  const chave = '41260711222333000181650010000000011234567890';
  const venda = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 10, total: 10, chaveNfce: chave, numeroNfce: 1,
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
    },
  });
  try {
    const resultado = await vendaService.buscarQrCode(tenant.id, venda.id);
    assert.equal(resultado.vendaId, venda.id);
    assert.equal(resultado.chaveNfce, chave);
    const hashEsperado = crypto.createHash('sha1').update(chave + '2' + '1' + 'CSCFAKE1234567890').digest('hex');
    assert.match(resultado.qrCodeUrl, new RegExp(`\\?p=${chave}\\|2\\|2\\|1\\|${hashEsperado}$`));
  } finally {
    await limparTenant(tenant.id, venda.id, produto.id);
  }
});

test('GET /api/vendas/:id/qrcode: erro claro (não derruba nada além de si mesmo) quando o CSC do ambiente atual não está configurado', async () => {
  const tenant = await criarTenant('02', { uf: 'PR', ambienteFiscal: 'homologacao' }); // sem cscHomologacao
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000002', nome: 'Produto QR Sem CSC', preco: 10 } });
  const venda = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 10, total: 10, chaveNfce: '4'.repeat(44), numeroNfce: 1,
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
    },
  });
  try {
    await assert.rejects(
      () => vendaService.buscarQrCode(tenant.id, venda.id),
      (erro) => { assert.equal(erro.status, 422); assert.match(erro.message, /CSC de homologação não configurado/); return true; }
    );
  } finally {
    await limparTenant(tenant.id, venda.id, produto.id);
  }
});

test('GET /api/vendas/:id/qrcode: erro claro quando a venda ainda não tem chave de acesso reservada', async () => {
  const tenant = await criarTenant('03', { uf: 'PR', ambienteFiscal: 'homologacao' });
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000003', nome: 'Produto Sem Chave', preco: 10 } });
  const venda = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 10, total: 10, // sem chaveNfce
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
    },
  });
  try {
    await assert.rejects(
      () => vendaService.buscarQrCode(tenant.id, venda.id),
      (erro) => { assert.equal(erro.status, 422); assert.match(erro.message, /chave de acesso reservada/); return true; }
    );
  } finally {
    await limparTenant(tenant.id, venda.id, produto.id);
  }
});

test('GET /api/vendas/:id/qrcode: erro claro quando a venda não existe', async () => {
  const tenant = await criarTenant('04');
  try {
    await assert.rejects(
      () => vendaService.buscarQrCode(tenant.id, 'id-que-nao-existe'),
      (erro) => { assert.equal(erro.status, 404); assert.match(erro.message, /não encontrada/); return true; }
    );
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

after(async () => {
  await prisma.$disconnect();
});
