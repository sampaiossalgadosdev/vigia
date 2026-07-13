/**
 * Arquivo: rede-sso.test.js
 * Responsabilidade: Regressão de segurança — a ponte de SSO (rede.service.sso)
 * não pode atrelar um Dono a uma conta de Superusuário "de verdade" (criada
 * pelo Superadmin, não pela própria ponte) só porque o e-mail bate. Isso
 * evitaria um Dono ganhar acesso às lojas de uma rede que não é a dele.
 * Uso: node --test src/tests/rede-sso.test.js
 * Depende de: DATABASE_URL válido em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const redeService = require('../services/rede.service');

function cnpjTeste(sufixo) {
  return '97' + Date.now().toString().slice(-11) + sufixo;
}

async function criarTenantPro(sufixo, email) {
  return prisma.tenant.create({
    data: { nome: `Teste SSO ${sufixo}`, cnpj: cnpjTeste(sufixo), email, plano: 'pro' },
  });
}

async function limpar(tenantId, superusuarioId) {
  if (superusuarioId) {
    await prisma.superusuarioTenant.deleteMany({ where: { superusuarioId } }).catch(() => {});
    await prisma.superusuario.delete({ where: { id: superusuarioId } }).catch(() => {});
  }
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('sso: Dono sem conta de rede prévia cria uma nova, marcada como origemSso, e ganha acesso ao próprio tenant', async () => {
  const email = `dono-sso-novo-${Date.now()}@teste.com`;
  const tenant = await criarTenantPro('01', email);
  let superusuarioId;
  try {
    const usuarioTenant = { isDono: true, email, nome: 'Dono Teste' };
    const resultado = await redeService.sso(usuarioTenant, tenant);
    superusuarioId = resultado.superusuario.id;

    const criado = await prisma.superusuario.findUnique({ where: { id: superusuarioId } });
    assert.equal(criado.origemSso, true);

    const vinculo = await prisma.superusuarioTenant.findFirst({ where: { superusuarioId, tenantId: tenant.id } });
    assert.ok(vinculo, 'deve atrelar o tenant do Dono à conta-ponte recém-criada');
  } finally {
    await limpar(tenant.id, superusuarioId);
  }
});

test('sso: e-mail já pertence a uma conta de rede real (origemSso=false) — bloqueia com 409, não atrela o tenant', async () => {
  const email = `dono-colisao-${Date.now()}@teste.com`;
  const tenant = await criarTenantPro('02', email);
  const contaReal = await prisma.superusuario.create({
    data: { nome: 'Superusuário Real', email, senha: 'hash-fake', origemSso: false },
  });
  try {
    const usuarioTenant = { isDono: true, email, nome: 'Dono Teste' };
    await assert.rejects(
      () => redeService.sso(usuarioTenant, tenant),
      (err) => { assert.equal(err.status, 409); return true; }
    );

    const vinculo = await prisma.superusuarioTenant.findFirst({ where: { superusuarioId: contaReal.id, tenantId: tenant.id } });
    assert.equal(vinculo, null, 'o tenant do Dono não pode ser atrelado à conta de rede real por coincidência de e-mail');
  } finally {
    await limpar(tenant.id, contaReal.id);
  }
});

test('sso: e-mail já pertence a uma conta-ponte anterior (origemSso=true, ex: mesmo Dono em outra loja) — permite e atrela o novo tenant', async () => {
  const email = `dono-multiloja-${Date.now()}@teste.com`;
  const tenant = await criarTenantPro('03', email);
  const contaPonte = await prisma.superusuario.create({
    data: { nome: 'Dono Teste', email, senha: 'hash-fake', origemSso: true },
  });
  try {
    const usuarioTenant = { isDono: true, email, nome: 'Dono Teste' };
    const resultado = await redeService.sso(usuarioTenant, tenant);
    assert.equal(resultado.superusuario.id, contaPonte.id);

    const vinculo = await prisma.superusuarioTenant.findFirst({ where: { superusuarioId: contaPonte.id, tenantId: tenant.id } });
    assert.ok(vinculo, 'deve atrelar o novo tenant à conta-ponte já existente do mesmo Dono');
  } finally {
    await limpar(tenant.id, contaPonte.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
