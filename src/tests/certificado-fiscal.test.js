/**
 * Arquivo: certificado-fiscal.test.js
 * Responsabilidade: Regressão de segurança/funcionalidade do upload de
 * certificado A1 (reaproveitado da Distribuição DF-e p/ configuração
 * fiscal): confirma que o certificado e a senha nunca ficam em texto
 * plano no banco (só criptografados, e descriptografam de volta pro
 * original), e que o upload rejeita quando o CNPJ do certificado não
 * bate com o CNPJ cadastrado do tenant.
 * Uso: node --test src/tests/certificado-fiscal.test.js
 * Depende de: DATABASE_URL e CERT_ENCRYPTION_KEY válidos em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const forge = require('node-forge');
const prisma = require('../config/database');
const superadminService = require('../services/superadmin.service');
const { descriptografar, descriptografarTexto } = require('../utils/certcrypto');

/**
 * Exatamente 14 dígitos (sufixo de 2 dígitos): precisa bater com os 14
 * dígitos que certificadoInfo.js extrai do CN do certificado (convenção
 * e-CNPJ), não só ser uma string única qualquer.
 */
function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

/**
 * Gera um .pfx autoassinado de teste com o Subject CN no formato
 * "RAZAO SOCIAL:CNPJ" — mesma convenção e-CNPJ (ICP-Brasil) que
 * certificadoInfo.js espera pra extrair o CNPJ.
 */
function gerarPfxFake(cnpj, senha) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: 'EMPRESA TESTE LTDA:' + cnpj },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

/** Gera um .pfx de teste com CN fora do padrão e-CNPJ (sem os 14 dígitos no final). */
function gerarPfxSemCnpjNoCn(senha) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: 'PESSOA SEM PADRAO E-CNPJ NO CN' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

test('certificado sem CNPJ extraível no CN é rejeitado (não pode passar batido)', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Certificado Sem CNPJ Extraivel', cnpj: cnpjTeste('50'), email: 'cert-sem-cnpj@teste.com', uf: 'PR' },
  });
  try {
    const senha = 'senhaTeste123';
    const pfxSemCnpj = gerarPfxSemCnpjNoCn(senha);

    await assert.rejects(
      () => superadminService.salvarCertificado(
        tenant.id, { buffer: pfxSemCnpj, originalname: 'sem-cnpj.pfx', size: pfxSemCnpj.length }, senha
      ),
      (err) => err.status === 422 && /Não foi possível validar o CNPJ/.test(err.message)
    );

    const registro = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    assert.equal(registro.certificadoPfx, null, 'upload rejeitado não pode ter salvo nada');
  } finally {
    await prisma.auditoria.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

test('certificado fica criptografado no banco, descriptografa pro original, e CNPJ divergente é rejeitado', async () => {
  const cnpjTenant = cnpjTeste('01');
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Certificado Fiscal', cnpj: cnpjTenant, email: 'cert-fiscal@teste.com', uf: 'PR' },
  });
  try {
    const senha = 'senhaTeste123';
    const pfxBuffer = gerarPfxFake(cnpjTenant, senha);

    const resultado = await superadminService.salvarCertificado(
      tenant.id, { buffer: pfxBuffer, originalname: 'teste.pfx', size: pfxBuffer.length }, senha
    );
    assert.ok(resultado.certificadoUploadEm);
    assert.ok(resultado.certificadoValidade, 'validade deve ser extraída do certificado');

    const registro = await prisma.tenant.findUnique({ where: { id: tenant.id } });

    // Nunca em texto plano no banco: nem o binário nem a senha batem com o original.
    assert.notEqual(registro.certificadoPfx.toString('binary'), pfxBuffer.toString('binary'));
    assert.notEqual(registro.certificadoSenha, senha);

    // Descriptografa de volta pro valor original.
    const binarioDecifrado = descriptografar(registro.certificadoPfx);
    assert.ok(binarioDecifrado.equals(pfxBuffer), 'binário descriptografado deve bater com o .pfx original');
    assert.equal(descriptografarTexto(registro.certificadoSenha), senha);

    // CNPJ divergente: certificado de OUTRO CNPJ deve ser rejeitado.
    const pfxCnpjErrado = gerarPfxFake(cnpjTeste('99'), senha);
    await assert.rejects(
      () => superadminService.salvarCertificado(
        tenant.id, { buffer: pfxCnpjErrado, originalname: 'errado.pfx', size: pfxCnpjErrado.length }, senha
      ),
      (err) => err.status === 422 && /CNPJ do certificado/.test(err.message)
    );

    // O certificado antigo (válido) continua salvo — o upload rejeitado não sobrescreveu nada.
    const depoisDaRejeicao = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    assert.ok(descriptografar(depoisDaRejeicao.certificadoPfx).equals(pfxBuffer));
  } finally {
    await prisma.auditoria.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

after(async () => {
  await prisma.$disconnect();
});
