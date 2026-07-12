/**
 * Arquivo: tenant-isolation.test.js
 * Responsabilidade: Regressão de segurança — garante que
 * produtoRepository.atualizar() nunca altera um registro de outro tenant,
 * mesmo chamado direto (sem passar pelo check-then-act do service).
 * Uso: node --test src/tests/tenant-isolation.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const produtoRepo = require('../repositories/produto.repository');
const caixaRepo = require('../repositories/caixa.repository');

function cnpjTeste(sufixo) {
  return '99' + Date.now().toString().slice(-11) + sufixo;
}

test('produtoRepository.atualizar não altera produto de outro tenant', async () => {
  const tenantA = await prisma.tenant.create({
    data: { nome: 'Teste Isolamento A', cnpj: cnpjTeste('01'), email: 'isolamento-a@teste.com' },
  });
  const tenantB = await prisma.tenant.create({
    data: { nome: 'Teste Isolamento B', cnpj: cnpjTeste('02'), email: 'isolamento-b@teste.com' },
  });
  let produtoA;
  let produtoB;

  try {
    produtoA = await prisma.produto.create({
      data: { tenantId: tenantA.id, ean: '9000000000001', nome: 'Produto A', preco: 10 },
    });
    produtoB = await prisma.produto.create({
      data: { tenantId: tenantB.id, ean: '9000000000002', nome: 'Produto B', preco: 20 },
    });

    // Tenant A tenta atualizar, direto no repository, um produto que pertence
    // ao Tenant B — só tem o UUID em mãos, sem passar pelo buscarPorId prévio
    // do service. Tem que falhar (o where agora exige id + tenantId juntos).
    await assert.rejects(() => produtoRepo.atualizar(tenantA.id, produtoB.id, { nome: 'HACKED' }));

    const depois = await prisma.produto.findUnique({ where: { id: produtoB.id } });
    assert.equal(depois.nome, 'Produto B', 'produto de outro tenant não pode ser alterado');
    assert.equal(Number(depois.preco), 20, 'preço do produto de outro tenant não pode ser alterado');
  } finally {
    if (produtoA) await prisma.produto.delete({ where: { id: produtoA.id } }).catch(() => {});
    if (produtoB) await prisma.produto.delete({ where: { id: produtoB.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantA.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantB.id } }).catch(() => {});
  }
});

test('caixaRepository.atualizar (reaproveitado por venda.service.js em registrar/cancelar) não altera caixa de outro tenant', async () => {
  const tenantA = await prisma.tenant.create({
    data: { nome: 'Teste Isolamento Caixa A', cnpj: cnpjTeste('03'), email: 'isolamento-caixa-a@teste.com' },
  });
  const tenantB = await prisma.tenant.create({
    data: { nome: 'Teste Isolamento Caixa B', cnpj: cnpjTeste('04'), email: 'isolamento-caixa-b@teste.com' },
  });
  let caixaB;

  try {
    caixaB = await prisma.caixa.create({
      data: { tenantId: tenantB.id, valorAbertura: 0, totalVendas: 100 },
    });

    // Tenant A (ex.: dentro de venda.service.registrar/cancelar) só tem o
    // UUID do caixa em mãos — se esse UUID pertencer a outro tenant (bug ou
    // ataque), o update tem que falhar, não silenciosamente afetar o caixa
    // errado. Simula exatamente os dois pontos corrigidos na Fase 0/complemento:
    // o update de totais dentro da transação da venda, e a reversão no cancelamento.
    await assert.rejects(() => caixaRepo.atualizar(prisma, tenantA.id, caixaB.id, { totalVendas: 999999 }));

    const depois = await prisma.caixa.findUnique({ where: { id: caixaB.id } });
    assert.equal(Number(depois.totalVendas), 100, 'caixa de outro tenant não pode ter os totais alterados');
  } finally {
    if (caixaB) await prisma.caixa.delete({ where: { id: caixaB.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantA.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantB.id } }).catch(() => {});
  }
});

after(async () => {
  await prisma.$disconnect();
});
