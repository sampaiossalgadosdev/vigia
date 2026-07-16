/**
 * Arquivo: assinatura-fiscal-modulo-perfil.test.js
 * Responsabilidade: Regressão do módulo "assinatura_fiscal" na tela de
 * Perfis — utils/modulos.js é a whitelist única usada tanto pelo validator
 * quanto por perfilService.normalizarPermissoes (ver header de
 * utils/modulos.js); sem "assinatura_fiscal" nela, criar um Perfil com essa
 * permissão era rejeitado com 422 mesmo com o módulo já existindo no enum
 * do banco. Confirma também a cadeia completa: Dono concede acesso_completo
 * → usuário com esse Perfil passa por exigeAcessoCompleto → consegue
 * buscar o certificado via fiscal.service.
 * Uso: node --test src/tests/assinatura-fiscal-modulo-perfil.test.js
 * Depende de: DATABASE_URL e CERT_ENCRYPTION_KEY válidos em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const perfilService = require('../services/perfil.service');
const fiscalService = require('../services/fiscal.service');
const { exigeAcessoCompleto } = require('../middlewares/permissao.middleware');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');
const { MODULOS } = require('../utils/modulos');

function cnpjTeste(sufixo) {
  return '96' + Date.now().toString().slice(-11) + sufixo;
}

async function limparTenant(tenantId) {
  await prisma.permissaoPerfil.deleteMany({ where: { perfil: { tenantId } } });
  await prisma.perfil.deleteMany({ where: { tenantId } });
  await prisma.auditoria.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

function mockRes() {
  const res = {};
  res.status = (codigo) => { res.statusCode = codigo; return res; };
  res.json = (corpo) => { res.body = corpo; return res; };
  return res;
}

test('utils/modulos.js inclui assinatura_fiscal na whitelist', () => {
  assert.ok(MODULOS.includes('assinatura_fiscal'));
});

test('Dono consegue criar Perfil com acesso_completo em assinatura_fiscal (não é mais "Módulo inválido")', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Modulo Assinatura Fiscal', cnpj: cnpjTeste('01'), email: 'modulo-assinatura@teste.com', uf: 'PR' },
  });
  try {
    const dono = { id: 'usuario-fake-dono', isDono: true };
    const perfil = await perfilService.criar(
      tenant.id, { nome: 'Gerente Assinatura', permissoes: [{ modulo: 'assinatura_fiscal', nivel: 'acesso_completo' }] }, dono, '127.0.0.1'
    );
    const permissaoAssinatura = perfil.permissoes.find((p) => p.modulo === 'assinatura_fiscal');
    assert.ok(permissaoAssinatura, 'perfil deve ter a permissão assinatura_fiscal gravada');
    assert.equal(permissaoAssinatura.nivel, 'acesso_completo');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('cadeia completa: usuário com Perfil acesso_completo em assinatura_fiscal passa por exigeAcessoCompleto e busca o certificado', async () => {
  const tenant = await prisma.tenant.create({
    data: {
      nome: 'Teste Cadeia Assinatura Fiscal', cnpj: cnpjTeste('02'), email: 'cadeia-assinatura@teste.com', uf: 'PR',
      certificadoPfx: criptografar(Buffer.from('conteudo-pfx-cadeia-completa')),
      certificadoSenha: criptografarTexto('senha-cadeia-completa'),
    },
  });
  try {
    const dono = { id: 'usuario-fake-dono', isDono: true };
    const perfil = await perfilService.criar(
      tenant.id, { nome: 'Gerente Assinatura 2', permissoes: [{ modulo: 'assinatura_fiscal', nivel: 'acesso_completo' }] }, dono, '127.0.0.1'
    );

    // Simula req.usuario como o middleware auth.js monta (auth.js:45-61): mapa modulo->nivel a partir do Perfil.
    const permissoes = {};
    for (const p of perfil.permissoes) permissoes[p.modulo] = p.nivel;
    const req = { usuario: { isDono: false, tenantId: tenant.id, permissoes } };
    const res = mockRes();
    let passou = false;
    exigeAcessoCompleto('assinatura_fiscal')(req, res, () => { passou = true; });
    assert.equal(passou, true, 'usuário com o Perfil recém-criado deve passar pela checagem estrita');

    const certificado = await fiscalService.buscarCertificadoParaAssinatura(req.usuario.tenantId);
    assert.equal(Buffer.from(certificado.pfxBase64, 'base64').toString('utf8'), 'conteudo-pfx-cadeia-completa');
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
