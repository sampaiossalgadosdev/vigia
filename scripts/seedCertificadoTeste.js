/**
 * Arquivo: seedCertificadoTeste.js
 * Responsabilidade: Gerar um certificado A1 de TESTE (auto-assinado, sem
 * validade fiscal/jurídica real, sem CA de verdade) e inserir no tenant
 * indicado através do MESMO fluxo de upload já existente
 * (superadmin.service.salvarCertificado — valida que o CNPJ do
 * certificado bate com o do tenant, criptografa com AES-256-GCM via
 * utils/certcrypto.js). Só serve pra destravar teste manual local (ex: app
 * ASSINATURA) em tenant sem certificado cadastrado ainda — não tem
 * nenhuma relação com o certificado A1 real do cliente.
 * Uso: node scripts/seedCertificadoTeste.js <cnpj|email>
 */
require('dotenv').config();
const forge = require('node-forge');
const prisma = require('../src/config/database');
const superadminService = require('../src/services/superadmin.service');

const SENHA_TESTE = 'teste123';

/** Mesma técnica de src/tests/certificado-fiscal.test.js: CN "RAZAO:CNPJ" (convenção e-CNPJ). */
function gerarPfxTeste(cnpj, senha) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: 'CERTIFICADO DE TESTE NAO USAR EM PRODUCAO:' + cnpj },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

async function main() {
  const identificador = process.argv[2];
  if (!identificador) {
    console.error('Uso: node scripts/seedCertificadoTeste.js <cnpj|email>');
    process.exitCode = 1;
    return;
  }

  const tenant = await prisma.tenant.findFirst({ where: { OR: [{ cnpj: identificador }, { email: identificador }] } });
  if (!tenant) {
    console.error('Tenant não encontrado para:', identificador);
    process.exitCode = 1;
    return;
  }

  console.log('='.repeat(72));
  console.log('CERTIFICADO DE TESTE — FICTÍCIO, SEM VALIDADE FISCAL OU JURÍDICA REAL.');
  console.log('Gerado localmente (auto-assinado), só pra destravar teste manual.');
  console.log('NUNCA use isso pra emitir nota fiscal de verdade.');
  console.log('='.repeat(72));

  const pfxBuffer = gerarPfxTeste(tenant.cnpj, SENHA_TESTE);
  const resultado = await superadminService.salvarCertificado(
    tenant.id,
    { buffer: pfxBuffer, originalname: 'certificado-teste.pfx', size: pfxBuffer.length },
    SENHA_TESTE
  );

  console.log('');
  console.log('Certificado de TESTE inserido em:', tenant.nome, '(' + tenant.cnpj + ')');
  console.log('Senha de teste:', SENHA_TESTE);
  console.log('Validade (fictícia):', resultado.certificadoValidade);
  console.log('');
  console.log('Lembrete: certificado 100% fictício — pendência do certificado A1');
  console.log('real do cliente continua em aberto, sem relação nenhuma com isto.');
}

main()
  .catch((e) => {
    console.error('Falha ao inserir certificado de teste:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
