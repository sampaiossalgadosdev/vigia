/**
 * Teste estrutural (Tarefa 2) -- node-dfe, com o certificado dummy
 * autoassinado (src/tests/fixtures/certificado-teste.pfx, senha senha123).
 * NÃO espera autorização de verdade -- só confirma: (a) a lib abre o .pfx
 * sem erro de parsing, (b) consegue assinar um XML de teste, (c) o erro
 * exato ao tentar chamar a SEFAZ de homologação de verdade (PR).
 */
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');
const lib = require('node-dfe');
const { Signature } = require('node-dfe/lib/factory/signature');

const PFX_PATH = path.join(__dirname, '..', '..', 'src', 'tests', 'fixtures', 'certificado-teste.pfx');
const SENHA = 'senha123';

function extrairKeyEPem(bufferPfx, senha) {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(bufferPfx.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = (certBags[forge.pki.oids.certBag] || [])[0];
  return {
    keyPem: forge.pki.privateKeyToPem(keyBag.key),
    certPem: forge.pki.certificateToPem(certBag.cert),
  };
}

async function main() {
  console.log('--- PASSO 1: abrir o .pfx com node-forge (pré-requisito p/ node-dfe, que espera key+pem separados) ---');
  const bufferPfx = fs.readFileSync(PFX_PATH);
  let keyPem, certPem;
  try {
    ({ keyPem, certPem } = extrairKeyEPem(bufferPfx, SENHA));
    console.log('OK: .pfx aberto e key/cert extraídos sem erro.');
  } catch (e) {
    console.log('FALHOU ao abrir o .pfx:', e.message);
    return;
  }

  const certificado = {
    key: keyPem,
    pem: certPem,
    pfx: bufferPfx,
    password: SENHA,
  };

  console.log('\n--- PASSO 2: assinar um XML de teste com Signature.signXmlX509 (sem rede) ---');
  try {
    const xmlTeste = '<consStatServ id="test" versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><cUF>41</cUF><xServ>STATUS</xServ></consStatServ>';
    const xmlAssinado = Signature.signXmlX509(xmlTeste, 'consStatServ', certificado);
    const assinado = xmlAssinado.includes('<Signature') || xmlAssinado.includes(':Signature');
    console.log('OK: assinatura gerada sem exceção. Contém tag <Signature>?', assinado);
    console.log('Tamanho do XML assinado:', xmlAssinado.length, 'bytes');
  } catch (e) {
    console.log('FALHOU ao assinar XML:', e.message);
  }

  console.log('\n--- PASSO 3: QR Code (gerarQRCodeNFCeOnline) -- sem rede ---');
  try {
    const empresaMinima = { idCSC: '1', CSC: 'CSCTESTE123', endereco: { uf: 'PR', cUf: '41' } };
    const nfeProc = new lib.NFeProcessor(empresaMinima);
    const url = nfeProc.gerarQRCodeNFCeOnline('https://www.homologacao.nfce.fazenda.pr.gov.br/nfce/qrcode?', '4'.repeat(44), '2', '2', '1', 'CSCTESTE123');
    console.log('OK: QR Code gerado nativamente pela lib:', url);
  } catch (e) {
    console.log('FALHOU ao gerar QR Code:', e.message);
  }

  console.log('\n--- PASSO 4: chamada REAL ao webservice de homologação da SEFAZ-PR (consultarStatusServico) ---');
  console.log('(Isso É uma chamada de rede de verdade a um ambiente de HOMOLOGAÇÃO -- não emite nada, só consulta status do serviço.)');
  try {
    const empresa = {
      razaoSocial: 'EMPRESA TESTE DUMMY LTDA', nomeFantasia: 'TESTE', cnpj: '12345678000199',
      inscricaoEstadual: '1234567890', codRegimeTributario: '3',
      endereco: { uf: 'PR', cUf: '41', codMunicipio: '4106902', municipio: 'Curitiba', cep: '80000000' },
      certificado, idCSC: '1', CSC: 'CSCTESTE123',
    };
    const statusProc = new lib.StatusServicoProcessor(empresa, '2', '65'); // ambiente 2 = homologação, modelo 65 = NFC-e
    const resultado = await statusProc.processarDocumento();
    console.log('Resposta recebida (sem exceção de rede) --', 'success:', resultado.success);
    console.log(require('util').inspect(resultado, { depth: 4 }).slice(0, 2000));
  } catch (e) {
    console.log('FALHOU (exceção) ao chamar o webservice real:', e.message);
    console.log(e.stack ? e.stack.slice(0, 800) : '');
  }
}

main();
