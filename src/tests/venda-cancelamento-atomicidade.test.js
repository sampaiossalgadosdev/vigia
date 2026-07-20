/**
 * Arquivo: venda-cancelamento-atomicidade.test.js
 * Responsabilidade: Regressão da atomicidade completa de venda.service.
 * cancelar() (achado de revisão 2026-07-20, endereçado nesta sessão a
 * pedido explícito do usuário — ver ARQUITETURA_FISCAL.md/relatório da
 * tarefa anterior): antes desta mudança, cancelar() era uma sequência de
 * escritas independentes sem nenhuma transação — uma queda de conexão no
 * meio podia deixar a venda cancelada na SEFAZ (ou operacionalmente) SEM
 * reverter estoque/caixa, ou reverter só parte dos itens. Agora status
 * (fiscal ou operacional) + reversão de caixa + reversão de estoque por
 * item rodam dentro de UMA ÚNICA transação (executarTransacaoComRetry,
 * mesmo helper de registrar() — ver venda-retry-conexao.test.js pro
 * classificador ehErroDeConexaoTransitoria em si, não repetido aqui).
 * Mesma técnica de mock (prisma.$transaction substituído temporariamente,
 * restaurado em finally) de venda-retry-conexao.test.js — não dá pra
 * reproduzir uma queda de conexão real sob demanda de forma determinística.
 * Uso: node --test --test-concurrency=1 src/tests/venda-cancelamento-atomicidade.test.js
 * (mesma recomendação de venda-cancelamento-fiscal.test.js: tenants fiscais
 * completos são mais pesados, sob concorrência padrão já observamos
 * instabilidade de conexão com o Railway não relacionada à lógica em si.)
 * Depende de: DATABASE_URL válido em .env. SEFAZ_MOCK=true.
 */
process.env.SEFAZ_MOCK = 'true';
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/database');
const vendaService = require('../services/venda.service');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Cancel Atomicidade ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `cancel-atom-${sufixo}-${Date.now()}@teste.com` },
  });
}

/** Tenant fiscal completo — necessário só pro caso 'emitido' (chama a SEFAZ mock). Mesmo padrão de venda-cancelamento-fiscal.test.js. */
async function criarTenantCompleto(sufixo) {
  return prisma.tenant.create({
    data: {
      nome: `Teste Cancel Atomicidade Completo ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `cancel-atom-completo-${sufixo}-${Date.now()}@teste.com`,
      uf: 'PR', regimeTributario: 'real', ambienteFiscal: 'homologacao',
      certificadoPfx: criptografar(Buffer.from('conteudo-fake-do-pfx')),
      certificadoSenha: criptografarTexto('senha-fake'),
      cnae: '4711-3/02', inscricaoEstadual: '123456789',
      cscProducao: criptografarTexto('csc-fake-prod'), cscProducaoId: '1',
      cscHomologacao: criptografarTexto('csc-fake-hom'), cscHomologacaoId: '1',
      logradouro: 'Rua Teste', numero: '100', bairro: 'Centro', municipio: 'Curitiba',
      codigoMunicipioIbge: '4106902', cep: '80000-000',
    },
  });
}

async function criarProduto(tenantId, sufixo) {
  return prisma.produto.create({
    data: { tenantId, ean: '97' + Date.now().toString().slice(-11) + sufixo, nome: 'Produto Cancel Atomicidade ' + sufixo, preco: 20, custoMedio: 10 },
  });
}

async function criarVenda(tenantId, produtoId, overrides = {}) {
  return prisma.venda.create({
    data: {
      tenantId, subtotal: 20, total: 20,
      itens: { create: [{ produtoId, quantidade: 1, precoUnitario: 20, custoUnitario: 10, subtotal: 20, total: 20 }] },
      pagamentos: { create: [{ forma: 'pix', valor: 20 }] },
      ...overrides,
    },
  });
}

async function limpar(tenantId, vendaId, produtoId) {
  await prisma.vendaPagamento.deleteMany({ where: { vendaId } }).catch(() => {});
  await prisma.vendaItem.deleteMany({ where: { vendaId } }).catch(() => {});
  await prisma.venda.delete({ where: { id: vendaId } }).catch(() => {});
  await prisma.movimentacaoEstoque.deleteMany({ where: { produtoId } }).catch(() => {});
  await prisma.produto.delete({ where: { id: produtoId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

function erroConexaoP1017() {
  return new Prisma.PrismaClientKnownRequestError('Server has closed the connection.', { code: 'P1017', clientVersion: '5.22.0' });
}

test('cancelar() [não-fiscal]: conexão cai UMA vez na transação de reversão e volta — venda cancelada, caixa E estoque revertidos corretamente', async () => {
  const tenant = await criarTenant('01');
  const produto = await criarProduto(tenant.id, '01');
  const caixa = await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  const venda = await criarVenda(tenant.id, produto.id, { chaveNfce: '6'.repeat(44), statusEmissaoFiscal: 'pendente' });
  const transactionOriginal = prisma.$transaction.bind(prisma);
  let chamadas = 0;
  prisma.$transaction = async (fn, opcoes) => {
    chamadas++;
    if (chamadas === 1) throw erroConexaoP1017();
    return transactionOriginal(fn, opcoes);
  };
  try {
    const resultado = await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Cliente desistiu', '127.0.0.1');
    assert.deepEqual(resultado, { cancelada: true });
    assert.equal(chamadas, 2, 'deve ter tentado a transação de reversão exatamente 2 vezes: a que falhou + a que funcionou');

    const vendaDepois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaDepois.status, 'cancelada');

    const caixaDepois = await prisma.caixa.findUnique({ where: { id: caixa.id } });
    assert.equal(Number(caixaDepois.totalVendas), 0, 'caixa deve ter revertido corretamente na tentativa que funcionou');

    const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { produtoId: produto.id, tipo: 'devolucao' } });
    assert.equal(movimentacoes.length, 1, 'estoque deve ter sido devolvido exatamente uma vez — não duplicado pela tentativa que falhou antes');
  } finally {
    prisma.$transaction = transactionOriginal;
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('cancelar() [não-fiscal]: conexão cai em TODAS as tentativas — nada é revertido (nem caixa, nem estoque, nem status), erro 503 claro pro chamador', async () => {
  const tenant = await criarTenant('02');
  const produto = await criarProduto(tenant.id, '02');
  const caixa = await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  const venda = await criarVenda(tenant.id, produto.id, { chaveNfce: '7'.repeat(44), statusEmissaoFiscal: 'pendente' });
  const transactionOriginal = prisma.$transaction.bind(prisma);
  let chamadas = 0;
  prisma.$transaction = async () => {
    chamadas++;
    throw erroConexaoP1017();
  };
  try {
    await assert.rejects(
      () => vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Cliente desistiu', '127.0.0.1'),
      (erro) => { assert.equal(erro.status, 503); assert.match(erro.message, /Sistema ocupado/); return true; }
    );
    assert.equal(chamadas, vendaService.MAX_TENTATIVAS_TRANSACAO, 'deve ter esgotado exatamente as tentativas configuradas');

    // A PROVA CENTRAL desta mudança: nada foi revertido PELA METADE.
    const vendaDepois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaDepois.status, 'concluida', 'venda NÃO pode ficar cancelada se a transação de reversão nunca aplicou');

    const caixaDepois = await prisma.caixa.findUnique({ where: { id: caixa.id } });
    assert.equal(Number(caixaDepois.totalVendas), 20, 'caixa NÃO pode ter sido tocado — a transação inteira falhou e reverteu (rollback do Postgres)');

    const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { produtoId: produto.id, tipo: 'devolucao' } });
    assert.equal(movimentacoes.length, 0, 'estoque NÃO pode ter sido devolvido — nem parcialmente');
  } finally {
    prisma.$transaction = transactionOriginal;
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('cancelar() [fiscal]: SEFAZ já confirmou, conexão cai UMA vez na transação local e volta — venda acaba cancelada com protocolo, caixa/estoque revertidos, sem erro pro chamador', async () => {
  const tenant = await criarTenantCompleto('03');
  const produto = await criarProduto(tenant.id, '03');
  const caixa = await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  const venda = await criarVenda(tenant.id, produto.id, { chaveNfce: '8'.repeat(44), statusEmissaoFiscal: 'emitido', emitidoEm: new Date() });
  const transactionOriginal = prisma.$transaction.bind(prisma);
  let chamadas = 0;
  prisma.$transaction = async (fn, opcoes) => {
    chamadas++;
    if (chamadas === 1) throw erroConexaoP1017();
    return transactionOriginal(fn, opcoes);
  };
  try {
    const resultado = await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Cliente desistiu da compra no caixa', '127.0.0.1');
    assert.deepEqual(resultado, { cancelada: true });
    assert.equal(chamadas, 2, 'a chamada à SEFAZ acontece UMA vez, fora do retry — só a escrita local (dentro da transação) é retentada');

    const vendaDepois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaDepois.status, 'cancelada');
    assert.ok(vendaDepois.protocoloCancelamento, 'protocolo da SEFAZ (mock) deve ter sido persistido na tentativa que funcionou');

    const caixaDepois = await prisma.caixa.findUnique({ where: { id: caixa.id } });
    assert.equal(Number(caixaDepois.totalVendas), 0);
  } finally {
    prisma.$transaction = transactionOriginal;
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('cancelar() [fiscal, risco residual documentado]: SEFAZ já confirmou mas a transação local esgota todas as tentativas — erro propaga claramente (não é engolido), venda fica INCONSISTENTE (cancelada na SEFAZ, não localmente) e isso é um risco conhecido, não um bug silencioso', async () => {
  const tenant = await criarTenantCompleto('04');
  const produto = await criarProduto(tenant.id, '04');
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  const venda = await criarVenda(tenant.id, produto.id, { chaveNfce: '9'.repeat(44), statusEmissaoFiscal: 'emitido', emitidoEm: new Date() });
  const transactionOriginal = prisma.$transaction.bind(prisma);
  let chamadas = 0;
  prisma.$transaction = async () => {
    chamadas++;
    throw erroConexaoP1017();
  };
  try {
    // A SEFAZ (mock) já respondeu ok ANTES da transação local começar —
    // isso não tem como ser desfeito (ver comentário "ATOMICIDADE" em
    // venda.service.cancelar). O que este teste prova é que a falha
    // subsequente propaga CLARA pro chamador (503), em vez de silenciar
    // ou fingir sucesso — quem opera o caixa sabe que precisa agir.
    await assert.rejects(
      () => vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Cliente desistiu da compra no caixa', '127.0.0.1'),
      (erro) => { assert.equal(erro.status, 503); assert.match(erro.message, /Sistema ocupado/); return true; }
    );
    assert.equal(chamadas, vendaService.MAX_TENTATIVAS_TRANSACAO);

    const vendaDepois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaDepois.status, 'concluida', 'a escrita local não aplicou (transação sempre falhou) — venda continua "concluida" localmente mesmo já cancelada na SEFAZ (mock)');
    assert.equal(vendaDepois.protocoloCancelamento, null, 'nada foi persistido — nem o protocolo que a SEFAZ (mock) já teria confirmado');
  } finally {
    prisma.$transaction = transactionOriginal;
    await limpar(tenant.id, venda.id, produto.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
