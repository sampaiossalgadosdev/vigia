/**
 * Arquivo: nfceXml.test.js
 * Responsabilidade: Confirma a montagem do XML da NFC-e (Fase 1b, sem
 * SEFAZ) e da URL do QR Code (hash SHA-1 sobre o CSC do tenant).
 * Uso: node --test src/tests/nfceXml.test.js
 * Teste unitário puro — sem banco, sem rede (venda é montada à mão).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');
const { NFE_SchemaValidate } = require('@nfewizard/nfce');
const { gerarXmlNfce, montarUrlQrCode } = require('../services/nfceXml.service');
const { criptografarTexto } = require('../utils/certcrypto');
const { calcularTributoItem } = require('../services/tributoFiscal.service');

function montarVendaDeTeste(regimeTributario = 'real') {
  const tenant = {
    cnpj: '12345678000199', nome: 'Mercado Teste LTDA', uf: 'PR',
    inscricaoEstadual: '1234567890', regimeTributario, ambienteFiscal: 'homologacao',
    cscHomologacao: criptografarTexto('CSCFAKE1234567890'), cscHomologacaoId: '1',
    cscProducao: null, cscProducaoId: null,
    logradouro: 'Rua das Flores', numero: '123', complemento: 'Loja 2', bairro: 'Centro',
    municipio: 'Curitiba', codigoMunicipioIbge: '4106902', cep: '80000-000',
  };
  const produto = { id: 'prod-1', codigoReferencia: '1', nome: 'Arroz 5kg', ncm: '10063011', cfop: '5102', unidade: 'UN' };
  const tributo = calcularTributoItem(tenant, produto, 27.9);
  const item = {
    produto, quantidade: 1, precoUnitario: 27.9, total: 27.9,
    valorIbs: tributo.valorIbs, valorCbs: tributo.valorCbs,
    cstIbsCbsAplicado: tributo.cstIbsCbsAplicado, cClassTribAplicado: tributo.cClassTribAplicado,
  };
  const venda = {
    id: 'venda-1', criadoEm: new Date('2026-07-15T12:00:00Z'),
    subtotal: 27.9, total: 27.9, desconto: 0,
    tenant, itens: [item], pagamentos: [{ forma: 'pix', valor: 27.9 }],
  };
  return { venda, tenant, item, tributo };
}

test('gerarXmlNfce produz XML parseável com IBS/CBS, NCM, CFOP e valores batendo com o calculado', () => {
  const { venda, tributo } = montarVendaDeTeste();
  const { xml, chaveAcesso } = gerarXmlNfce(venda);

  assert.equal(typeof xml, 'string');
  assert.equal(chaveAcesso.length, 44, 'chave de acesso deve ter 44 dígitos');
  assert.match(chaveAcesso, /^\d{44}$/, 'chave de acesso deve conter só dígitos');

  // parseTagValue: false — NCM/CFOP/CST/cClassTrib são códigos fiscais, não
  // números; não deixamos o parser converter e perder zeros à esquerda.
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
  const doc = parser.parse(xml);
  const infNFe = doc.NFe.infNFe;
  const det = infNFe.det;

  assert.equal(det.prod.NCM, '10063011');
  assert.equal(det.prod.CFOP, '5102');
  assert.equal(Number(det.prod.vProd), 27.9);

  // CST/cClassTrib no XML são o placeholder NUMÉRICO (formato exigido pelo
  // schema, \d{3}/\d{6}) -- não o marcador de texto de tributoFiscal.service
  // (cstIbsCbsAplicado/cClassTribAplicado), que continua sendo usado
  // internamente/no banco. Ver nfceXml.service.js pra detalhes.
  const ibscbs = det.imposto.IBSCBS;
  assert.match(ibscbs.CST, /^\d{3}$/);
  assert.match(ibscbs.cClassTrib, /^\d{6}$/);
  assert.equal(Number(ibscbs.gIBSCBS.gCBS.vCBS), tributo.valorCbs);
  assert.equal(Number(ibscbs.gIBSCBS.gIBSUF.vIBSUF), tributo.valorIbs);
  assert.equal(Number(ibscbs.gIBSCBS.vIBS), tributo.valorIbs);

  // Total cobrado do cliente continua igual — IBS/CBS é destacado, não somado.
  assert.equal(Number(infNFe.total.ICMSTot.vNF), 27.9);

  // enderEmit preenchido com os dados reais do tenant.
  const ender = infNFe.emit.enderEmit;
  assert.equal(ender.xLgr, 'Rua das Flores');
  assert.equal(ender.nro, '123');
  assert.equal(ender.xCpl, 'Loja 2');
  assert.equal(ender.xBairro, 'Centro');
  assert.equal(ender.cMun, '4106902');
  assert.equal(ender.xMun, 'Curitiba');
  assert.equal(ender.UF, 'PR');
  // CEP sem máscara -- TCep exige só dígitos ([0-9]{8}); o '-' é removido.
  assert.equal(ender.CEP, '80000000');

  // CRT numérico (regime 'real' → 3), não o texto solto do regime.
  assert.equal(infNFe.emit.CRT, '3');
});

test('gerarXmlNfce: CRT numérico bate com MAPA_CRT para cada regime tributário', () => {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });

  const { venda: vendaSimples } = montarVendaDeTeste('simples');
  const crtSimples = parser.parse(gerarXmlNfce(vendaSimples).xml).NFe.infNFe.emit.CRT;
  assert.equal(crtSimples, '1');

  const { venda: vendaPresumido } = montarVendaDeTeste('presumido');
  const crtPresumido = parser.parse(gerarXmlNfce(vendaPresumido).xml).NFe.infNFe.emit.CRT;
  assert.equal(crtPresumido, '3');

  const { venda: vendaReal } = montarVendaDeTeste('real');
  const crtReal = parser.parse(gerarXmlNfce(vendaReal).xml).NFe.infNFe.emit.CRT;
  assert.equal(crtReal, '3');
});

test('QR Code: URL formatada corretamente e hash SHA-1 bate com valor de referência calculado manualmente', () => {
  const { venda } = montarVendaDeTeste();
  const { chaveAcesso } = gerarXmlNfce(venda);

  const url = montarUrlQrCode(venda.tenant, chaveAcesso, 'https://consulta.fake.sefaz/qr');

  // tpAmb=2 (homologação), idCsc=1, CSC em texto plano 'CSCFAKE1234567890' — calculado manualmente, não copiado da implementação.
  const hashEsperado = crypto.createHash('sha1').update(chaveAcesso + '2' + '1' + 'CSCFAKE1234567890').digest('hex');
  assert.equal(url, `https://consulta.fake.sefaz/qr?p=${chaveAcesso}|2|2|1|${hashEsperado}`);
});

test('QR Code: lança erro claro se o CSC do ambiente atual não estiver configurado', () => {
  const { venda } = montarVendaDeTeste();
  const { chaveAcesso } = gerarXmlNfce(venda);
  venda.tenant.ambienteFiscal = 'producao'; // este tenant de teste só tem CSC de homologação
  assert.throws(
    () => montarUrlQrCode(venda.tenant, chaveAcesso, 'https://consulta.fake.sefaz/qr'),
    (err) => err.status === 422 && /CSC de produção não configurado/.test(err.message)
  );
});

/**
 * gerarXmlNfce propositalmente NÃO inclui o atributo Id (infNFe) nem
 * Signature/infNFeSupl — esses são adicionados pela @nfewizard/nfce no
 * momento real da assinatura (fora do escopo desta função, que só monta o
 * XML de conteúdo, sem assinar nem consultar SEFAZ). Validar o XML de
 * gerarXmlNfce direto contra o schema sempre acusaria essas duas ausências
 * (confirmado no Passo 0 desta fase), mascarando se o CONTEÚDO está
 * completo ou não. Por isso, só pra teste, complementamos com um Id/
 * Signature FICTÍCIOS antes de validar — isolando exatamente o que
 * gerarXmlNfce é responsável por produzir. Confirmado contra o fluxo real
 * (chamarWebserviceReal, que assina de verdade) que essas duas ausências
 * mesmo somem quando o XML passa pela lib de verdade.
 */
function comIdESignatureFicticios(xml, chaveAcesso) {
  // qrCode no formato "V2 ONLINE" (um dos 5 aceitos pelo schema) com dados
  // fictícios, mas estruturalmente válidos (chaveAcesso real reaproveitada,
  // já tem tpEmis=1 na posição certa por padrão).
  const qrCodeFake = `https://fake.test/qr?p=${chaveAcesso}|2|2|0|${'a'.repeat(40)}`;
  // Signature XML-DSig fictícia (valores não são criptograficamente
  // válidos, mas a validação de SCHEMA não verifica assinatura, só forma).
  const signatureFake = '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#teste"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>VHSorp7hXmzygONSclvjYuyItYU=</DigestValue></Reference></SignedInfo><SignatureValue>ZmFrZS1zaWduYXR1cmUtdmFsdWUtc28tbG9uZy1lbm91Z2gtdG8tbG9vay1yZWFsaXN0aWM=</SignatureValue><KeyInfo><X509Data><X509Certificate>ZmFrZS1jZXJ0aWZpY2F0ZQ==</X509Certificate></X509Data></KeyInfo></Signature>';
  return xml
    .replace('<infNFe versao="4.00">', `<infNFe versao="4.00" Id="NFe${chaveAcesso}">`)
    .replace('</NFe>', `<infNFeSupl><qrCode>${qrCodeFake}</qrCode><urlChave>https://fake.test/consulta</urlChave></infNFeSupl>${signatureFake}</NFe>`);
}

test('gerarXmlNfce: passa limpo na validação de schema padrão da lib (JS-based) — regime "simples" (sem grupo IBSCBS)', async () => {
  const { venda } = montarVendaDeTeste('simples');
  const { xml, chaveAcesso } = gerarXmlNfce(venda);

  // Confirma a decisão desta fase: Simples Nacional OMITE o grupo IBSCBS
  // inteiro (minOccurs=0 no schema), em vez de forçar um CST fictício.
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
  const imposto = parser.parse(xml).NFe.infNFe.det.imposto;
  assert.equal(imposto.IBSCBS, undefined, 'regime simples não deve emitir o grupo IBSCBS');

  await assert.doesNotReject(() => NFE_SchemaValidate(comIdESignatureFicticios(xml, chaveAcesso), 'NFEAutorizacao'));
});

test('gerarXmlNfce: passa limpo na validação de schema padrão da lib (JS-based) — regime "presumido" e "real" (com IBSCBS calculado)', async () => {
  for (const regime of ['presumido', 'real']) {
    const { venda } = montarVendaDeTeste(regime);
    const { xml, chaveAcesso } = gerarXmlNfce(venda);

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
    const imposto = parser.parse(xml).NFe.infNFe.det.imposto;
    assert.ok(imposto.IBSCBS, `regime ${regime} deve emitir o grupo IBSCBS`);

    await assert.doesNotReject(() => NFE_SchemaValidate(comIdESignatureFicticios(xml, chaveAcesso), 'NFEAutorizacao'), `regime ${regime} deveria passar na validação de schema`);
  }
});
