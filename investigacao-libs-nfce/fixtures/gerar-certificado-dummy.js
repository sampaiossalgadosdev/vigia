/**
 * Gera um certificado .pfx AUTOASSINADO de teste (NÃO é ICP-Brasil, não
 * autentica de verdade com a SEFAZ) — só serve pra testar se uma lib
 * consegue abrir/parsear um .pfx e tentar assinar um XML, sem depender de
 * um certificado real. Senha fixa: senha123.
 *
 * Uso: node gerar-certificado-dummy.js
 * Gera: ../../src/tests/fixtures/certificado-teste.pfx (fixture do app,
 * referenciado por prompts futuros da Fase 1c — o arquivo não existia
 * ainda quando esta investigação começou).
 */
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

const SENHA = 'senha123';
const CNPJ_TESTE = '12345678000199';

function gerarPfxFake() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5);
  const attrs = [
    { name: 'commonName', value: 'EMPRESA TESTE DUMMY LTDA:' + CNPJ_TESTE },
    { name: 'countryName', value: 'BR' },
    { shortName: 'ST', value: 'PR' },
    { name: 'localityName', value: 'Curitiba' },
    { name: 'organizationName', value: 'Empresa Teste Dummy Ltda' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, nonRepudiation: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], SENHA, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

const destino = path.join(__dirname, '..', '..', 'src', 'tests', 'fixtures', 'certificado-teste.pfx');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, gerarPfxFake());
console.log('Certificado dummy gerado em:', destino);
console.log('Senha:', SENHA, '| CNPJ (fake, embutido no CN):', CNPJ_TESTE);
