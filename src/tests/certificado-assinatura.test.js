/**
 * Arquivo: certificado-assinatura.test.js
 * Responsabilidade: Regressão de segurança do endpoint GET /api/fiscal/
 * certificado (busca do certificado digital pro app ASSINATURA) — garante
 * que só usuário com acesso_completo no módulo assinatura_fiscal passa pela
 * checagem estrita (exigeAcessoCompleto, não exigePermissao — somente_leitura
 * não deve bastar), e que a busca do certificado nunca vaza entre tenants.
 * Uso: node --test src/tests/certificado-assinatura.test.js
 * Depende de: DATABASE_URL e CERT_ENCRYPTION_KEY válidos em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const { exigeAcessoCompleto } = require('../middlewares/permissao.middleware');
const fiscalService = require('../services/fiscal.service');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');

function cnpjTeste(sufixo) {
  return '97' + Date.now().toString().slice(-11) + sufixo;
}

function mockRes() {
  const res = {};
  res.status = (codigo) => {
    res.statusCode = codigo;
    return res;
  };
  res.json = (corpo) => {
    res.body = corpo;
    return res;
  };
  return res;
}

test('exigeAcessoCompleto rejeita usuário com só somente_leitura no módulo (exigePermissao aceitaria, este não pode)', () => {
  const middleware = exigeAcessoCompleto('assinatura_fiscal');
  const req = { usuario: { isDono: false, permissoes: { assinatura_fiscal: 'somente_leitura' } } };
  const res = mockRes();
  let nextChamado = false;
  middleware(req, res, () => { nextChamado = true; });

  assert.equal(nextChamado, false, 'não pode chamar next() sem acesso_completo');
  assert.equal(res.statusCode, 403);
});

test('exigeAcessoCompleto rejeita usuário sem nenhuma permissão no módulo', () => {
  const middleware = exigeAcessoCompleto('assinatura_fiscal');
  const req = { usuario: { isDono: false, permissoes: {} } };
  const res = mockRes();
  let nextChamado = false;
  middleware(req, res, () => { nextChamado = true; });

  assert.equal(nextChamado, false);
  assert.equal(res.statusCode, 403);
});

test('exigeAcessoCompleto permite usuário com acesso_completo no módulo', () => {
  const middleware = exigeAcessoCompleto('assinatura_fiscal');
  const req = { usuario: { isDono: false, permissoes: { assinatura_fiscal: 'acesso_completo' } } };
  const res = mockRes();
  let nextChamado = false;
  middleware(req, res, () => { nextChamado = true; });

  assert.equal(nextChamado, true);
  assert.equal(res.statusCode, undefined, 'não deve ter respondido erro nenhum');
});

test('exigeAcessoCompleto sempre permite o Dono, independente do mapa de permissões', () => {
  const middleware = exigeAcessoCompleto('assinatura_fiscal');
  const req = { usuario: { isDono: true, permissoes: {} } };
  const res = mockRes();
  let nextChamado = false;
  middleware(req, res, () => { nextChamado = true; });

  assert.equal(nextChamado, true);
});

test('fiscal.service busca o certificado do tenant certo — não vaza entre tenants', async () => {
  const tenantA = await prisma.tenant.create({
    data: {
      nome: 'Teste Cert Assinatura A', cnpj: cnpjTeste('01'), email: 'cert-assinatura-a@teste.com', uf: 'PR',
      certificadoPfx: criptografar(Buffer.from('conteudo-pfx-tenant-a')),
      certificadoSenha: criptografarTexto('senha-tenant-a'),
    },
  });
  const tenantB = await prisma.tenant.create({
    data: {
      nome: 'Teste Cert Assinatura B', cnpj: cnpjTeste('02'), email: 'cert-assinatura-b@teste.com', uf: 'PR',
      certificadoPfx: criptografar(Buffer.from('conteudo-pfx-tenant-b')),
      certificadoSenha: criptografarTexto('senha-tenant-b'),
    },
  });
  try {
    const certA = await fiscalService.buscarCertificadoParaAssinatura(tenantA.id);
    const certB = await fiscalService.buscarCertificadoParaAssinatura(tenantB.id);

    assert.equal(Buffer.from(certA.pfxBase64, 'base64').toString('utf8'), 'conteudo-pfx-tenant-a');
    assert.equal(certA.senha, 'senha-tenant-a');
    assert.equal(Buffer.from(certB.pfxBase64, 'base64').toString('utf8'), 'conteudo-pfx-tenant-b');
    assert.equal(certB.senha, 'senha-tenant-b');
    assert.notEqual(certA.pfxBase64, certB.pfxBase64, 'certificado de A não pode ser igual ao de B');
  } finally {
    await prisma.tenant.delete({ where: { id: tenantA.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantB.id } }).catch(() => {});
  }
});

test('fiscal.service rejeita tenant sem certificado cadastrado', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Sem Certificado Assinatura', cnpj: cnpjTeste('03'), email: 'sem-cert-assinatura@teste.com', uf: 'PR' },
  });
  try {
    await assert.rejects(
      () => fiscalService.buscarCertificadoParaAssinatura(tenant.id),
      (err) => err.status === 422
    );
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

after(async () => {
  await prisma.$disconnect();
});
