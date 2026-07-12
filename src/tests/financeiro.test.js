/**
 * Arquivo: financeiro.test.js
 * Responsabilidade: Regressão da Fase 4a — Contas a Pagar e a Receber
 * (fundação): criação validada, listagem com filtro de vencimento, baixa
 * (rejeita se já baixada/cancelada) e cancelamento (exige motivo).
 * Uso: node --test src/tests/financeiro.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const contaPagarService = require('../services/contaPagar.service');
const contaReceberService = require('../services/contaReceber.service');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Financeiro ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `financeiro-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.contaPagar.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.contaReceber.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.fornecedor.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

function diasAPartirDeAgora(dias) {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
}

test('ContaPagar: criar valida descrição, valor e vencimento; sucesso vincula fornecedor opcional', async () => {
  const tenant = await criarTenant('01');
  try {
    await assert.rejects(
      () => contaPagarService.criar(tenant.id, { descricao: '', valor: 100, dataVencimento: diasAPartirDeAgora(10) }, { id: 'usuario-teste' }, '127.0.0.1'),
      (erro) => { assert.match(erro.message, /Descrição/); return true; }
    );
    await assert.rejects(
      () => contaPagarService.criar(tenant.id, { descricao: 'Aluguel', valor: 0, dataVencimento: diasAPartirDeAgora(10) }, { id: 'usuario-teste' }, '127.0.0.1'),
      (erro) => { assert.match(erro.message, /Valor/); return true; }
    );
    await assert.rejects(
      () => contaPagarService.criar(tenant.id, { descricao: 'Aluguel', valor: 100 }, { id: 'usuario-teste' }, '127.0.0.1'),
      (erro) => { assert.match(erro.message, /vencimento/i); return true; }
    );

    const fornecedor = await prisma.fornecedor.create({ data: { tenantId: tenant.id, nome: 'Fornecedor Teste', cnpj: cnpjTeste('91') } });
    const conta = await contaPagarService.criar(tenant.id, { descricao: 'Compra de insumos', valor: 500, dataVencimento: diasAPartirDeAgora(15), fornecedorId: fornecedor.id }, { id: 'usuario-teste' }, '127.0.0.1');

    assert.equal(conta.status, 'aberto');
    assert.equal(Number(conta.valor), 500);
    assert.equal(conta.fornecedor.id, fornecedor.id);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('ContaPagar: listar com filtro de vencimento (vencidas e próximos N dias)', async () => {
  const tenant = await criarTenant('02');
  try {
    await contaPagarService.criar(tenant.id, { descricao: 'Conta Vencida', valor: 100, dataVencimento: diasAPartirDeAgora(-5) }, { id: 'usuario-teste' }, '127.0.0.1');
    await contaPagarService.criar(tenant.id, { descricao: 'Conta Próxima', valor: 200, dataVencimento: diasAPartirDeAgora(3) }, { id: 'usuario-teste' }, '127.0.0.1');
    await contaPagarService.criar(tenant.id, { descricao: 'Conta Distante', valor: 300, dataVencimento: diasAPartirDeAgora(60) }, { id: 'usuario-teste' }, '127.0.0.1');

    const vencidas = await contaPagarService.listar(tenant.id, { vencidas: 'true' }, { page: 1, limit: 20, skip: 0 });
    assert.equal(vencidas.items.length, 1);
    assert.equal(vencidas.items[0].descricao, 'Conta Vencida');

    const proximos7dias = await contaPagarService.listar(tenant.id, { dias: '7' }, { page: 1, limit: 20, skip: 0 });
    assert.equal(proximos7dias.items.length, 1);
    assert.equal(proximos7dias.items[0].descricao, 'Conta Próxima');

    const todas = await contaPagarService.listar(tenant.id, {}, { page: 1, limit: 20, skip: 0 });
    assert.equal(todas.items.length, 3);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('ContaPagar: dar baixa muda status pra pago e rejeita se já baixada/cancelada', async () => {
  const tenant = await criarTenant('03');
  try {
    const conta = await contaPagarService.criar(tenant.id, { descricao: 'Água', valor: 80, dataVencimento: diasAPartirDeAgora(5) }, { id: 'usuario-teste' }, '127.0.0.1');

    const baixada = await contaPagarService.darBaixa(tenant.id, conta.id, { formaPagamento: 'pix' }, { id: 'usuario-teste' }, '127.0.0.1');
    assert.equal(baixada.status, 'pago');
    assert.equal(baixada.formaPagamento, 'pix');
    assert.ok(baixada.dataPagamento);

    await assert.rejects(
      () => contaPagarService.darBaixa(tenant.id, conta.id, {}, { id: 'usuario-teste' }, '127.0.0.1'),
      (erro) => { assert.match(erro.message, /já está pago/); return true; }
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

test('ContaPagar: cancelar exige motivo e muda status pra cancelado; rejeita se já paga', async () => {
  const tenant = await criarTenant('04');
  try {
    const conta = await contaPagarService.criar(tenant.id, { descricao: 'Internet', valor: 150, dataVencimento: diasAPartirDeAgora(5) }, { id: 'usuario-teste' }, '127.0.0.1');

    await assert.rejects(
      () => contaPagarService.cancelar(tenant.id, conta.id, '   ', { id: 'usuario-teste' }, '127.0.0.1'),
      (erro) => { assert.match(erro.message, /motivo/i); return true; }
    );

    const cancelada = await contaPagarService.cancelar(tenant.id, conta.id, 'Duplicidade de lançamento', { id: 'usuario-teste' }, '127.0.0.1');
    assert.equal(cancelada.status, 'cancelado');
    assert.match(cancelada.observacao, /Duplicidade de lançamento/);

    await assert.rejects(
      () => contaPagarService.darBaixa(tenant.id, conta.id, {}, { id: 'usuario-teste' }, '127.0.0.1'),
      (erro) => { assert.match(erro.message, /já está cancelado/); return true; }
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

test('ContaReceber: criar, listar com filtro de vencimento, dar baixa e cancelar seguem as mesmas regras', async () => {
  const tenant = await criarTenant('05');
  try {
    await assert.rejects(
      () => contaReceberService.criar(tenant.id, { descricao: '', valor: 100, dataVencimento: diasAPartirDeAgora(10) }, { id: 'usuario-teste' }, '127.0.0.1')
    );

    const vencida = await contaReceberService.criar(tenant.id, { descricao: 'Recebível Vencido', valor: 300, dataVencimento: diasAPartirDeAgora(-2) }, { id: 'usuario-teste' }, '127.0.0.1');
    await contaReceberService.criar(tenant.id, { descricao: 'Recebível Futuro', valor: 400, dataVencimento: diasAPartirDeAgora(90) }, { id: 'usuario-teste' }, '127.0.0.1');

    const vencidas = await contaReceberService.listar(tenant.id, { vencidas: 'true' }, { page: 1, limit: 20, skip: 0 });
    assert.equal(vencidas.items.length, 1);
    assert.equal(vencidas.items[0].id, vencida.id);

    const baixada = await contaReceberService.darBaixa(tenant.id, vencida.id, { formaRecebimento: 'dinheiro' }, { id: 'usuario-teste' }, '127.0.0.1');
    assert.equal(baixada.status, 'recebido');
    assert.ok(baixada.dataRecebimento);

    await assert.rejects(
      () => contaReceberService.darBaixa(tenant.id, vencida.id, {}, { id: 'usuario-teste' }, '127.0.0.1'),
      (erro) => { assert.match(erro.message, /já está recebido/); return true; }
    );

    const outra = await contaReceberService.criar(tenant.id, { descricao: 'Recebível a cancelar', valor: 50, dataVencimento: diasAPartirDeAgora(10) }, { id: 'usuario-teste' }, '127.0.0.1');
    await assert.rejects(() => contaReceberService.cancelar(tenant.id, outra.id, '', { id: 'usuario-teste' }, '127.0.0.1'));
    const cancelada = await contaReceberService.cancelar(tenant.id, outra.id, 'Cliente desistiu da compra', { id: 'usuario-teste' }, '127.0.0.1');
    assert.equal(cancelada.status, 'cancelado');
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
