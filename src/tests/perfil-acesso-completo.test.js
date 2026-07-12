/**
 * Arquivo: perfil-acesso-completo.test.js
 * Responsabilidade: Regressão de segurança — garante que só o Dono do
 * tenant pode conceder nível acesso_completo num Perfil (evita escalação
 * de privilégio por um usuário não-Dono com acesso à tela de Perfis).
 * Uso: node --test src/tests/perfil-acesso-completo.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const perfilService = require('../services/perfil.service');

function cnpjTeste(sufixo) {
  return '98' + Date.now().toString().slice(-11) + sufixo;
}

const permissoesComAcessoCompleto = [{ modulo: 'usuarios', nivel: 'acesso_completo' }];

async function limparTenant(tenantId) {
  await prisma.permissaoPerfil.deleteMany({ where: { perfil: { tenantId } } });
  await prisma.perfil.deleteMany({ where: { tenantId } });
  await prisma.auditoria.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('não-Dono não pode criar Perfil com acesso_completo', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Perfil Nao Dono', cnpj: cnpjTeste('01'), email: 'perfil-nao-dono@teste.com' },
  });
  try {
    const naoDono = { id: 'usuario-fake-nao-dono', isDono: false };
    await assert.rejects(
      () => perfilService.criar(tenant.id, { nome: 'Perfil Escalado', permissoes: permissoesComAcessoCompleto }, naoDono, '127.0.0.1'),
      (err) => err.status === 403
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

test('Dono pode criar Perfil com acesso_completo', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Perfil Dono', cnpj: cnpjTeste('02'), email: 'perfil-dono@teste.com' },
  });
  try {
    const dono = { id: 'usuario-fake-dono', isDono: true };
    const perfil = await perfilService.criar(tenant.id, { nome: 'Perfil Total', permissoes: permissoesComAcessoCompleto }, dono, '127.0.0.1');
    assert.ok(perfil.id);
    const permissaoUsuarios = perfil.permissoes.find((p) => p.modulo === 'usuarios');
    assert.equal(permissaoUsuarios.nivel, 'acesso_completo');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('não-Dono não pode editar Perfil existente para acesso_completo', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Perfil Editar', cnpj: cnpjTeste('03'), email: 'perfil-editar@teste.com' },
  });
  try {
    const dono = { id: 'usuario-fake-dono', isDono: true };
    const naoDono = { id: 'usuario-fake-nao-dono', isDono: false };
    // Dono cria o perfil com um nível seguro primeiro.
    const perfil = await perfilService.criar(
      tenant.id, { nome: 'Perfil Base', permissoes: [{ modulo: 'usuarios', nivel: 'somente_leitura' }] }, dono, '127.0.0.1'
    );

    await assert.rejects(
      () => perfilService.atualizar(tenant.id, perfil.id, { permissoes: permissoesComAcessoCompleto }, naoDono, '127.0.0.1'),
      (err) => err.status === 403
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
