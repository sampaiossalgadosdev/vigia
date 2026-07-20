/**
 * Arquivo: venda-retry-conexao.test.js
 * Responsabilidade: Regressão do retry automático de venda.service.registrar()
 * contra queda TRANSITÓRIA de conexão com o Postgres (achado de revisão
 * 2026-07-20 — proxy do Railway derrubando conexões sob carga, reproduzido
 * repetidas vezes durante os testes desta sessão inteira, sempre resolvido
 * numa nova tentativa). Estende o retry que já existia só para lock_timeout
 * (P2010/55P03) — ver ehErroDeLockTimeout, não coberto por este arquivo.
 * `ehErroDeConexaoTransitoria` (classificador puro) é testado direto contra
 * instâncias REAIS das classes de erro do Prisma (Prisma.PrismaClient
 * InitializationError/PrismaClientKnownRequestError) — não objetos forjados
 * à mão — pra garantir que o `instanceof` usado na implementação bate com o
 * que o Prisma de verdade lança (confirmado empiricamente contra este
 * projeto: Prisma 5.22.0 — ver comentário no código-fonte).
 * O comportamento de retry em si (`registrar()` de ponta a ponta) é testado
 * substituindo temporariamente `prisma.$transaction` por uma versão que
 * falha um número controlado de vezes antes de delegar pro `$transaction`
 * real — mesma técnica de "mock com restore em finally" já usada em
 * vendaContingencia.test.js (fetch)/filaVendasSync.test.js, adaptada pro
 * Prisma real (não dá pra reproduzir uma queda de conexão real sob
 * demanda de forma determinística).
 * Uso: node --test src/tests/venda-retry-conexao.test.js
 * Depende de: DATABASE_URL válido em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/database');
const vendaService = require('../services/venda.service');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Retry Conexao ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `retry-${sufixo}-${Date.now()}@teste.com` },
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

function erroConexaoP1001() {
  // Mesma classe/mensagem confirmada empiricamente num teste isolado
  // (conexão apontada pra host inalcançável) — ver comentário em
  // ehErroDeConexaoTransitoria no código-fonte.
  return new Prisma.PrismaClientInitializationError("Can't reach database server", '5.22.0');
}

function erroConexaoP1017() {
  return new Prisma.PrismaClientKnownRequestError('Server has closed the connection.', { code: 'P1017', clientVersion: '5.22.0' });
}

// ─── ehErroDeConexaoTransitoria: classificador puro ───────────────────────

test('ehErroDeConexaoTransitoria: PrismaClientInitializationError (conexão nem se estabelece, ex: P1001) é retentável', () => {
  assert.equal(vendaService.ehErroDeConexaoTransitoria(erroConexaoP1001()), true);
});

test('ehErroDeConexaoTransitoria: PrismaClientKnownRequestError code=P1017 (conexão derrubada em pleno uso) é retentável', () => {
  assert.equal(vendaService.ehErroDeConexaoTransitoria(erroConexaoP1017()), true);
});

test('ehErroDeConexaoTransitoria: PrismaClientKnownRequestError com a MESMA mensagem mas code diferente ainda é retentável (fallback por mensagem)', () => {
  const erro = new Prisma.PrismaClientKnownRequestError('Server has closed the connection.', { code: 'P9999', clientVersion: '5.22.0' });
  assert.equal(vendaService.ehErroDeConexaoTransitoria(erro), true, 'o fallback por mensagem existe justamente pra não depender só do code, que não foi possível confirmar 100% sob controle');
});

test('ehErroDeConexaoTransitoria: PrismaClientKnownRequestError de outro tipo (ex: violação de unique constraint) NÃO é retentável', () => {
  const erro = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`cnpj`)', { code: 'P2002', clientVersion: '5.22.0' });
  assert.equal(vendaService.ehErroDeConexaoTransitoria(erro), false, 'erro de negócio real (dado duplicado) nunca pode ser tratado como transitório');
});

test('ehErroDeConexaoTransitoria: erro de negócio comum (AppError, sem .code) NÃO é retentável', () => {
  const erro = new Error('Produto não encontrado');
  erro.status = 404;
  assert.equal(vendaService.ehErroDeConexaoTransitoria(erro), false);
});

test('ehErroDeConexaoTransitoria: null/undefined não lança, devolve false', () => {
  assert.equal(vendaService.ehErroDeConexaoTransitoria(null), false);
  assert.equal(vendaService.ehErroDeConexaoTransitoria(undefined), false);
});

// ─── registrar(): comportamento de retry de ponta a ponta ─────────────────

test('registrar(): conexão cai UMA vez (P1017) e volta na tentativa seguinte — venda é criada normalmente, sem erro pro chamador', async () => {
  const tenant = await criarTenant('01');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000001', nome: 'Produto Retry 01', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const transactionOriginal = prisma.$transaction.bind(prisma);
  let chamadas = 0;
  prisma.$transaction = async (fn, opcoes) => {
    chamadas++;
    if (chamadas === 1) throw erroConexaoP1017();
    return transactionOriginal(fn, opcoes);
  };
  try {
    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }] },
      { id: 'usuario-teste' }, '127.0.0.1'
    );
    assert.equal(chamadas, 2, 'deve ter tentado exatamente 2 vezes: a que falhou + a que funcionou');
    assert.ok(venda.id, 'venda deve ter sido criada de verdade na segunda tentativa');

    const persistida = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.ok(persistida, 'venda deve estar realmente persistida no banco, não só um retorno fake');
  } finally {
    prisma.$transaction = transactionOriginal;
    await limparTenant(tenant.id);
  }
});

test('registrar(): conexão cai em TODAS as tentativas — desiste após o limite (mesmo de lock_timeout) e devolve 503 claro, nunca um erro genérico', async () => {
  const tenant = await criarTenant('02');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000002', nome: 'Produto Retry 02', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const transactionOriginal = prisma.$transaction.bind(prisma);
  let chamadas = 0;
  prisma.$transaction = async () => {
    chamadas++;
    throw erroConexaoP1001();
  };
  try {
    await assert.rejects(
      () => vendaService.registrar(
        tenant.id,
        { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }] },
        { id: 'usuario-teste' }, '127.0.0.1'
      ),
      (erro) => { assert.equal(erro.status, 503); assert.match(erro.message, /Sistema ocupado/); return true; }
    );
    assert.equal(chamadas, vendaService.MAX_TENTATIVAS_TRANSACAO, `deve ter esgotado exatamente as ${vendaService.MAX_TENTATIVAS_TRANSACAO} tentativas configuradas, nem mais nem menos`);

    const count = await prisma.venda.count({ where: { tenantId: tenant.id } });
    assert.equal(count, 0, 'nenhuma venda deve ter sido persistida quando todas as tentativas falham');
  } finally {
    prisma.$transaction = transactionOriginal;
    await limparTenant(tenant.id);
  }
});

test('registrar(): erro que NÃO é de conexão nem de lock_timeout propaga na primeira tentativa, sem esperar nem tentar de novo', async () => {
  const tenant = await criarTenant('03');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000003', nome: 'Produto Retry 03', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const transactionOriginal = prisma.$transaction.bind(prisma);
  let chamadas = 0;
  const erroDeNegocio = new Error('Falha simulada não relacionada a conexão');
  prisma.$transaction = async () => {
    chamadas++;
    throw erroDeNegocio;
  };
  try {
    await assert.rejects(
      () => vendaService.registrar(
        tenant.id,
        { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }] },
        { id: 'usuario-teste' }, '127.0.0.1'
      ),
      (erro) => { assert.equal(erro, erroDeNegocio, 'erro genérico deve propagar exatamente como veio, sem ser transformado em 503'); return true; }
    );
    assert.equal(chamadas, 1, 'não deve retentar um erro que não é de conexão nem de lock_timeout');
  } finally {
    prisma.$transaction = transactionOriginal;
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
