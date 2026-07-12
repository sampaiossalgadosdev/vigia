/**
 * Arquivo: transferencia-transformacao.test.js
 * Responsabilidade: Regressão da Fase 2d — transferência de estoque entre
 * depósitos e transformação de produto, reaproveitando a infraestrutura de
 * ajuste manual auditável da Fase 2c (MovimentacaoEstoque com
 * quantidadeAnterior/Nova, depositoId, loteId).
 * Uso: node --test src/tests/transferencia-transformacao.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const loteRepo = require('../repositories/lote.repository');
const transferenciaService = require('../services/transferencia.service');
const transformacaoService = require('../services/transformacao.service');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Transf ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `transf-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.movimentacaoEstoque.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.lote.deleteMany({ where: { estoqueProduto: { produto: { tenantId } } } }).catch(() => {});
  await prisma.estoqueProduto.deleteMany({ where: { produto: { tenantId } } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.deposito.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

function diasAPartirDeAgora(dias) {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}

test('transferência sem lote: origem decrementa, destino incrementa, agregados corretos, dois MovimentacaoEstoque vinculados', async () => {
  const tenant = await criarTenant('01');
  try {
    const depositoOrigem = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const depositoDestino = await estoqueDepositoRepo.criarDeposito(tenant.id, 'Depósito Secundário');
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9990000000001', nome: 'Produto Transferível', preco: 10, estoqueQtd: 0 } });
    await estoqueDepositoRepo.definirQuantidade(prisma, produto.id, depositoOrigem.id, 20);

    const resultado = await transferenciaService.transferirEstoque(tenant.id, 'usuario-teste', produto.id, depositoOrigem.id, depositoDestino.id, 8, 'Rebalanceamento entre depósitos');

    assert.equal(Number(resultado.saida.quantidade), -8);
    assert.equal(Number(resultado.saida.quantidadeAnterior), 20);
    assert.equal(Number(resultado.saida.quantidadeNova), 12);
    assert.equal(Number(resultado.entrada.quantidade), 8);
    assert.equal(Number(resultado.entrada.quantidadeAnterior), 0);
    assert.equal(Number(resultado.entrada.quantidadeNova), 8);
    assert.equal(resultado.saida.origemId, resultado.entrada.origemId, 'os dois registros devem estar vinculados pelo mesmo identificador de transferência');
    assert.equal(resultado.saida.tipo, 'transferencia');
    assert.equal(resultado.entrada.tipo, 'transferencia');

    const estoqueOrigemDepois = await prisma.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId: produto.id, depositoId: depositoOrigem.id } } });
    const estoqueDestinoDepois = await prisma.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId: produto.id, depositoId: depositoDestino.id } } });
    assert.equal(Number(estoqueOrigemDepois.quantidade), 12);
    assert.equal(Number(estoqueDestinoDepois.quantidade), 8);

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 20, 'agregado total não muda — só se move entre depósitos');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('transferência com lote: move preservando validade — cria um novo lote no destino quando não existe igual', async () => {
  const tenant = await criarTenant('02');
  try {
    const depositoOrigem = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const depositoDestino = await estoqueDepositoRepo.criarDeposito(tenant.id, 'Depósito Secundário');
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9990000000002', nome: 'Produto Lote Transferível', preco: 10, estoqueQtd: 0, controlaLote: true } });
    const estoqueOrigem = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, depositoOrigem.id);
    const validade = diasAPartirDeAgora(15);
    const lote = await prisma.lote.create({ data: { estoqueProdutoId: estoqueOrigem.id, numeroLote: 'L-100', dataValidade: validade, quantidade: 10 } });

    const resultado = await transferenciaService.transferirEstoque(tenant.id, 'usuario-teste', produto.id, depositoOrigem.id, depositoDestino.id, 6, 'Transferência de lote', lote.id);

    const loteOrigemDepois = await prisma.lote.findUnique({ where: { id: lote.id } });
    assert.equal(Number(loteOrigemDepois.quantidade), 4);
    assert.equal(loteOrigemDepois.ativo, true);

    const estoqueDestino = await estoqueDepositoRepo.buscarEstoqueProduto(prisma, produto.id, depositoDestino.id);
    const lotesDestino = await prisma.lote.findMany({ where: { estoqueProdutoId: estoqueDestino.id } });
    assert.equal(lotesDestino.length, 1, 'deve criar exatamente um novo lote no destino');
    assert.equal(lotesDestino[0].numeroLote, 'L-100');
    assert.equal(Number(lotesDestino[0].quantidade), 6);
    assert.equal(new Date(lotesDestino[0].dataValidade).getTime(), validade.getTime(), 'validade deve ser preservada na transferência');
    assert.equal(resultado.entrada.loteId, lotesDestino[0].id);

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 10, '4 (origem) + 6 (destino) = 10');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('transferência com lote: incrementa lote já existente no destino em vez de duplicar', async () => {
  const tenant = await criarTenant('03');
  try {
    const depositoOrigem = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const depositoDestino = await estoqueDepositoRepo.criarDeposito(tenant.id, 'Depósito Secundário');
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9990000000003', nome: 'Produto Lote Existente', preco: 10, estoqueQtd: 0, controlaLote: true } });
    const estoqueOrigem = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, depositoOrigem.id);
    const estoqueDestino = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, depositoDestino.id);
    const validade = diasAPartirDeAgora(20);
    const loteOrigem = await prisma.lote.create({ data: { estoqueProdutoId: estoqueOrigem.id, numeroLote: 'L-200', dataValidade: validade, quantidade: 10 } });
    const loteDestinoExistente = await prisma.lote.create({ data: { estoqueProdutoId: estoqueDestino.id, numeroLote: 'L-200', dataValidade: validade, quantidade: 3 } });
    await loteRepo.recalcularEstoqueProdutoDeLotes(prisma, estoqueDestino.id, produto.id);

    const resultado = await transferenciaService.transferirEstoque(tenant.id, 'usuario-teste', produto.id, depositoOrigem.id, depositoDestino.id, 6, 'Transferência de lote existente', loteOrigem.id);

    const lotesDestino = await prisma.lote.findMany({ where: { estoqueProdutoId: estoqueDestino.id } });
    assert.equal(lotesDestino.length, 1, 'não deve duplicar — deve incrementar o lote já existente');
    assert.equal(lotesDestino[0].id, loteDestinoExistente.id);
    assert.equal(Number(lotesDestino[0].quantidade), 9, '3 + 6');
    assert.equal(resultado.entrada.loteId, loteDestinoExistente.id);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('transferência bloqueada por permiteEstoqueNegativo na origem', async () => {
  const tenant = await criarTenant('04');
  try {
    const depositoOrigem = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const depositoDestino = await estoqueDepositoRepo.criarDeposito(tenant.id, 'Depósito Secundário');
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9990000000004', nome: 'Produto Travado', preco: 10, estoqueQtd: 0 } });
    await estoqueDepositoRepo.definirQuantidade(prisma, produto.id, depositoOrigem.id, 5);
    await estoqueDepositoRepo.definirPermiteNegativo(prisma, tenant.id, produto.id, false);

    await assert.rejects(
      () => transferenciaService.transferirEstoque(tenant.id, 'usuario-teste', produto.id, depositoOrigem.id, depositoDestino.id, 10, 'Transferência maior que o disponível'),
      (erro) => { assert.match(erro.message, /Estoque insuficiente/); return true; }
    );

    const estoqueOrigemDepois = await prisma.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId: produto.id, depositoId: depositoOrigem.id } } });
    assert.equal(Number(estoqueOrigemDepois.quantidade), 5, 'origem não deve ser alterada quando a transferência é bloqueada');

    const estoqueDestinoDepois = await estoqueDepositoRepo.buscarEstoqueProduto(prisma, produto.id, depositoDestino.id);
    assert.equal(estoqueDestinoDepois, null, 'destino nem deve chegar a ser criado quando a transferência é bloqueada');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('transformação sem lote em nenhum dos dois produtos: consome origem e gera destino corretamente, dois MovimentacaoEstoque vinculados', async () => {
  const tenant = await criarTenant('05');
  try {
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const origem = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9990000000005', nome: 'Peixe Inteiro', preco: 20, estoqueQtd: 0 } });
    const destino = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9990000000006', nome: 'Filé de Peixe', preco: 40, estoqueQtd: 0 } });
    await estoqueDepositoRepo.definirQuantidade(prisma, origem.id, deposito.id, 20);

    const resultado = await transformacaoService.transformarProduto(tenant.id, 'usuario-teste', origem.id, destino.id, deposito.id, 5, 3, 'Processamento de peixe em filé');

    assert.equal(Number(resultado.origem.quantidade), -5);
    assert.equal(Number(resultado.origem.quantidadeAnterior), 20);
    assert.equal(Number(resultado.origem.quantidadeNova), 15);
    assert.equal(Number(resultado.destino.quantidade), 3);
    assert.equal(Number(resultado.destino.quantidadeAnterior), 0);
    assert.equal(Number(resultado.destino.quantidadeNova), 3);
    assert.equal(resultado.origem.origemId, resultado.destino.origemId);
    assert.equal(resultado.origem.tipo, 'transformacao');

    const origemDepois = await prisma.produto.findUnique({ where: { id: origem.id } });
    const destinoDepois = await prisma.produto.findUnique({ where: { id: destino.id } });
    assert.equal(Number(origemDepois.estoqueQtd), 15);
    assert.equal(Number(destinoDepois.estoqueQtd), 3);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('transformação com lote na origem: bloqueia se o lote estiver vencido', async () => {
  const tenant = await criarTenant('06');
  try {
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const origem = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9990000000007', nome: 'Peixe Com Lote', preco: 20, estoqueQtd: 0, controlaLote: true } });
    const destino = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9990000000008', nome: 'Filé Com Lote Origem', preco: 40, estoqueQtd: 0 } });
    const estoqueOrigem = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, origem.id, deposito.id);
    const lote = await prisma.lote.create({ data: { estoqueProdutoId: estoqueOrigem.id, dataValidade: diasAPartirDeAgora(-2), quantidade: 10 } });

    await assert.rejects(
      () => transformacaoService.transformarProduto(tenant.id, 'usuario-teste', origem.id, destino.id, deposito.id, 5, 3, 'Tentativa com lote vencido', lote.id),
      (erro) => { assert.match(erro.message, /possui lote vencido/); return true; }
    );

    const loteDepois = await prisma.lote.findUnique({ where: { id: lote.id } });
    assert.equal(Number(loteDepois.quantidade), 10, 'lote vencido não deve ser tocado quando a transformação é bloqueada');

    const destinoDepois = await prisma.produto.findUnique({ where: { id: destino.id } });
    assert.equal(Number(destinoDepois.estoqueQtd), 0, 'destino não deve receber nada quando a transformação é bloqueada');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('transformação com lote no destino: exige dataValidadeDestino, rejeita se não vier, cria o Lote corretamente se vier', async () => {
  const tenant = await criarTenant('07');
  try {
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const origem = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9990000000009', nome: 'Peixe Sem Lote', preco: 20, estoqueQtd: 0 } });
    const destino = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9990000000010', nome: 'Filé Com Lote Destino', preco: 40, estoqueQtd: 0, controlaLote: true } });
    await estoqueDepositoRepo.definirQuantidade(prisma, origem.id, deposito.id, 20);

    await assert.rejects(
      () => transformacaoService.transformarProduto(tenant.id, 'usuario-teste', origem.id, destino.id, deposito.id, 5, 3, 'Sem informar validade do destino'),
      (erro) => { assert.match(erro.message, /dataValidadeDestino/); return true; }
    );
    const destinoDepoisBloqueio = await prisma.produto.findUnique({ where: { id: destino.id } });
    assert.equal(Number(destinoDepoisBloqueio.estoqueQtd), 0, 'nada deve ser criado quando a validade obrigatória não é informada');

    const validadeDestino = diasAPartirDeAgora(7);
    const resultado = await transformacaoService.transformarProduto(tenant.id, 'usuario-teste', origem.id, destino.id, deposito.id, 5, 3, 'Informando validade do destino', undefined, validadeDestino);

    const estoqueDestino = await estoqueDepositoRepo.buscarEstoqueProduto(prisma, destino.id, deposito.id);
    const lotesDestino = await prisma.lote.findMany({ where: { estoqueProdutoId: estoqueDestino.id } });
    assert.equal(lotesDestino.length, 1);
    assert.equal(Number(lotesDestino[0].quantidade), 3);
    assert.equal(new Date(lotesDestino[0].dataValidade).getTime(), validadeDestino.getTime());
    assert.equal(resultado.destino.loteId, lotesDestino[0].id);

    const destinoDepois = await prisma.produto.findUnique({ where: { id: destino.id } });
    assert.equal(Number(destinoDepois.estoqueQtd), 3);
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
