/**
 * Arquivo: chaveAssinaturaLocal.test.js
 * Responsabilidade: Regressão de fiscal.service.buscarOuCriarChaveAssinaturaLocal
 * — o segredo de pareamento local (LAN da loja) entre vigia-pdv e o app
 * ASSINATURA (fecha o buraco de servidorAssinatura.js aceitar qualquer
 * requisição da rede sem autenticação). Cobre: geração na primeira busca,
 * idempotência (buscas seguintes devolvem o mesmo valor), criptografia em
 * repouso (nunca texto plano no banco) e tenant inexistente.
 * Uso: node --test src/tests/chaveAssinaturaLocal.test.js
 * Depende de: DATABASE_URL e CERT_ENCRYPTION_KEY válidos em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const { buscarOuCriarChaveAssinaturaLocal } = require('../services/fiscal.service');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Chave Assinatura ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `chave-assinatura-${sufixo}@teste.com` },
  });
}

test('buscarOuCriarChaveAssinaturaLocal: primeira busca gera uma chave nova, persistida criptografada (nunca em texto plano)', async () => {
  const tenant = await criarTenant('01');
  try {
    const chave = await buscarOuCriarChaveAssinaturaLocal(tenant.id);
    assert.ok(chave && chave.length > 0);

    const tenantDepois = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { chaveAssinaturaLocal: true } });
    assert.ok(tenantDepois.chaveAssinaturaLocal, 'deve ter persistido algo');
    assert.notEqual(tenantDepois.chaveAssinaturaLocal, chave, 'o valor gravado no banco deve estar criptografado, diferente do valor em claro devolvido');
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

test('buscarOuCriarChaveAssinaturaLocal: segunda busca devolve exatamente a mesma chave (não gera outra)', async () => {
  const tenant = await criarTenant('02');
  try {
    const primeira = await buscarOuCriarChaveAssinaturaLocal(tenant.id);
    const segunda = await buscarOuCriarChaveAssinaturaLocal(tenant.id);
    assert.equal(segunda, primeira, 'buscas seguintes devem reaproveitar a chave já gerada, não trocar a cada chamada');
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

test('buscarOuCriarChaveAssinaturaLocal: tenants diferentes recebem chaves diferentes', async () => {
  const tenantA = await criarTenant('03a');
  const tenantB = await criarTenant('03b');
  try {
    const chaveA = await buscarOuCriarChaveAssinaturaLocal(tenantA.id);
    const chaveB = await buscarOuCriarChaveAssinaturaLocal(tenantB.id);
    assert.notEqual(chaveA, chaveB);
  } finally {
    await prisma.tenant.delete({ where: { id: tenantA.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantB.id } }).catch(() => {});
  }
});

test('buscarOuCriarChaveAssinaturaLocal: tenant inexistente lança 404 claro', async () => {
  await assert.rejects(
    () => buscarOuCriarChaveAssinaturaLocal('id-que-nao-existe'),
    (erro) => { assert.equal(erro.status, 404); assert.match(erro.message, /não encontrado/); return true; }
  );
});

after(async () => {
  await prisma.$disconnect();
});
