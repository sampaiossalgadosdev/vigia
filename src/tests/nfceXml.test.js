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
  // cstIbsCbs '000'/cClassTrib '000001': códigos REAIS confirmados contra
  // DOCS/cClassTrib 2026-06-22.xlsx (RT 2025.002) — ver tributoFiscal.test.js.
  // indGIbsCbs=true/indGRed=false: indicadores REAIS de '000' (Tributação
  // integral, sem redução) no catálogo — ver CLASSIFICACAO_FISCAL_INTEGRAL
  // em tributoFiscal.test.js.
  const produto = { id: 'prod-1', codigoReferencia: '1', nome: 'Arroz 5kg', ncm: '10063011', cfop: '5102', unidade: 'UN', cstIbsCbs: '000', cClassTrib: '000001' };
  const classificacaoFiscal = { indGIbsCbs: true, indGRed: false, pRedIbs: null, pRedCbs: null };
  const tributo = calcularTributoItem(tenant, produto, 27.9, classificacaoFiscal);
  const item = {
    produto, quantidade: 1, precoUnitario: 27.9, total: 27.9,
    ...tributo,
  };
  const venda = {
    id: 'venda-1', criadoEm: new Date('2026-07-15T12:00:00Z'), numeroNfce: 1,
    subtotal: 27.9, total: 27.9, desconto: 0,
    tenant, itens: [item], pagamentos: [{ forma: 'pix', valor: 27.9 }],
  };
  return { venda, tenant, item, tributo };
}

test('gerarXmlNfce produz XML parseável com IBS/CBS, NCM, CFOP e valores batendo com o calculado', () => {
  const { venda, tributo, item } = montarVendaDeTeste();
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

  // CST/cClassTrib no XML são o código REAL cadastrado no produto (ver
  // montarVendaDeTeste acima) — repassado tal como está por
  // tributoFiscal.service.calcularTributoItem, sem tradução/placeholder.
  const ibscbs = det.imposto.IBSCBS;
  assert.equal(ibscbs.CST, item.produto.cstIbsCbs);
  assert.equal(ibscbs.cClassTrib, item.produto.cClassTrib);
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

test('gerarXmlNfce: número usado no <nNF> e na chave de acesso é exatamente venda.numeroNfce (sequencial real, não mais aleatório)', () => {
  const { venda } = montarVendaDeTeste();
  venda.numeroNfce = 42;
  const { xml, chaveAcesso } = gerarXmlNfce(venda);

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
  const nNF = parser.parse(xml).NFe.infNFe.ide.nNF;
  assert.equal(nNF, '42');
  // Chave de acesso: posições 25-33 (34-42 em base-1) são o número, 9 dígitos com zero à esquerda.
  assert.equal(chaveAcesso.slice(25, 34), '000000042');
});

test('gerarXmlNfce: lança erro claro se numeroNfce não foi reservado antes (nunca cai num placeholder aleatório silencioso)', () => {
  const { venda } = montarVendaDeTeste();
  delete venda.numeroNfce;
  assert.throws(
    () => gerarXmlNfce(venda),
    (err) => err.status === 500 && /numeroNfce não foi reservado/.test(err.message)
  );
});

test('gerarXmlNfce: lança erro claro se a data de emissão é 2027 ou depois — rateio IBS estadual/municipal (Art. 344, LC 214/2025) ainda não foi implementado', () => {
  const { venda } = montarVendaDeTeste('real');
  venda.criadoEm = new Date('2027-01-01T03:00:00Z'); // 2027-01-01 00:00 no fuso BR (-03:00) — exatamente o corte
  assert.throws(
    () => gerarXmlNfce(venda),
    (err) => err.status === 500 && /Rateio de IBS entre estado e município desatualizado/.test(err.message)
  );
});

test('gerarXmlNfce: 2026 (ano corrente da alíquota-teste) continua emitindo normalmente — guard de 2027 não dispara antes da hora', () => {
  const { venda } = montarVendaDeTeste('real');
  venda.criadoEm = new Date('2026-12-31T23:59:59Z');
  assert.doesNotThrow(() => gerarXmlNfce(venda));
});

/**
 * CST 200 + cClassTrib 200003 (cesta básica) — códigos REAIS confirmados
 * no catálogo (DOCS/cClassTrib 2026-06-22.xlsx, Art. 125 LC 214/2025:
 * "Ficam reduzidas a zero as alíquotas do IBS e da CBS" — pRedIBS=
 * pRedCBS=100). NT 2025.002-RTC v1.50, regras UB65-10/UB66-10: pIBSUF/pCBS
 * SEMPRE mostram a alíquota estatutária cheia (0,1%/0,9%); é gRed/pAliqEfet
 * que reflete o percentual líquido, e vIBSUF/vCBS o valor já reduzido.
 */
test('gerarXmlNfce: CST 200 com redução de alíquota (cesta básica, pRedIBS=pRedCBS=100) — monta gIBSUF/gRed e gCBS/gRed corretamente, pIBSUF/pCBS continuam com a alíquota estatutária cheia', () => {
  const { venda, tenant } = montarVendaDeTeste('real');
  const produto = { id: 'prod-2', codigoReferencia: '2', nome: 'Feijão 1kg', ncm: '07133399', cfop: '5102', unidade: 'UN' };
  const classificacaoFiscal = { indGIbsCbs: true, indGRed: true, pRedIbs: 100, pRedCbs: 100 };
  const tributo = calcularTributoItem(tenant, { ...produto, cstIbsCbs: '200', cClassTrib: '200003' }, 10, classificacaoFiscal);
  venda.itens = [{ produto, quantidade: 1, precoUnitario: 10, total: 10, ...tributo }];

  const { xml, chaveAcesso } = gerarXmlNfce(venda);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
  const ibscbs = parser.parse(xml).NFe.infNFe.det.imposto.IBSCBS;

  assert.equal(ibscbs.CST, '200');
  assert.equal(ibscbs.cClassTrib, '200003');
  assert.equal(ibscbs.gIBSCBS.gIBSUF.pIBSUF, '0.10', 'pIBSUF continua sendo a alíquota estatutária, não a reduzida (UB65-10/UB66-10)');
  assert.equal(ibscbs.gIBSCBS.gCBS.pCBS, '0.90');
  assert.equal(ibscbs.gIBSCBS.gIBSUF.gRed.pRedAliq, '100.00');
  assert.equal(ibscbs.gIBSCBS.gCBS.gRed.pRedAliq, '100.00');
  assert.equal(Number(ibscbs.gIBSCBS.gIBSUF.gRed.pAliqEfet), 0, 'redução de 100% zera a alíquota efetiva');
  assert.equal(Number(ibscbs.gIBSCBS.gCBS.gRed.pAliqEfet), 0);
  assert.equal(Number(ibscbs.gIBSCBS.gIBSUF.vIBSUF), 0);
  assert.equal(Number(ibscbs.gIBSCBS.gCBS.vCBS), 0);
});

test('gerarXmlNfce: CST 200 com redução parcial (60%) — pAliqEfet e vIBSUF/vCBS refletem o percentual líquido, passa na validação de schema real', async () => {
  const { venda, tenant } = montarVendaDeTeste('real');
  const produto = { id: 'prod-3', codigoReferencia: '3', nome: 'Biscoito', ncm: '19053100', cfop: '5102', unidade: 'UN' };
  const classificacaoFiscal = { indGIbsCbs: true, indGRed: true, pRedIbs: 60, pRedCbs: 60 };
  const tributo = calcularTributoItem(tenant, { ...produto, cstIbsCbs: '200', cClassTrib: '200034' }, 100, classificacaoFiscal);
  venda.itens = [{ produto, quantidade: 1, precoUnitario: 100, total: 100, ...tributo }];

  const { xml, chaveAcesso } = gerarXmlNfce(venda);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
  const ibscbs = parser.parse(xml).NFe.infNFe.det.imposto.IBSCBS;

  // pAliqEfet = 0.1 * (1 - 0.6) = 0.04 ; 0.9 * (1 - 0.6) = 0.36
  assert.equal(ibscbs.gIBSCBS.gIBSUF.gRed.pAliqEfet, '0.0400');
  assert.equal(ibscbs.gIBSCBS.gCBS.gRed.pAliqEfet, '0.3600');
  assert.equal(Number(ibscbs.gIBSCBS.gIBSUF.vIBSUF), 0.04);
  assert.equal(Number(ibscbs.gIBSCBS.gCBS.vCBS), 0.36);

  await assert.doesNotReject(() => NFE_SchemaValidate(comIdESignatureFicticios(xml, chaveAcesso), 'NFEAutorizacao'), 'XML com gRed parcial deveria passar na validação de schema padrão');
});

/**
 * CST 410 (imunidade/não incidência) — código REAL confirmado no catálogo.
 * NT 2025.002-RTC v1.50: "Se CST do IBS/CBS informado possui indicador que
 * não permite a informação do IBS/CBS (ind_gIBSCBS = 0): Grupo gIBSCBS
 * informado" é rejeição — o grupo de valor precisa vir OMITIDO, não com
 * zeros.
 */
test('gerarXmlNfce: CST 410 (imunidade — livros/jornais) — omite o grupo gIBSCBS inteiro, mantém CST/cClassTrib, passa na validação de schema real', async () => {
  const { venda, tenant } = montarVendaDeTeste('real');
  const produto = { id: 'prod-4', codigoReferencia: '4', nome: 'Livro Infantil', ncm: '49019900', cfop: '5102', unidade: 'UN' };
  const classificacaoFiscal = { indGIbsCbs: false, indGRed: false, pRedIbs: null, pRedCbs: null };
  const tributo = calcularTributoItem(tenant, { ...produto, cstIbsCbs: '410', cClassTrib: '410008' }, 30, classificacaoFiscal);
  venda.itens = [{ produto, quantidade: 1, precoUnitario: 30, total: 30, ...tributo }];

  const { xml, chaveAcesso } = gerarXmlNfce(venda);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
  const ibscbs = parser.parse(xml).NFe.infNFe.det.imposto.IBSCBS;

  assert.equal(ibscbs.CST, '410');
  assert.equal(ibscbs.cClassTrib, '410008');
  assert.equal(ibscbs.gIBSCBS, undefined, 'CST com ind_gIBSCBS=0 não deve emitir o grupo de valor');

  await assert.doesNotReject(() => NFE_SchemaValidate(comIdESignatureFicticios(xml, chaveAcesso), 'NFEAutorizacao'), 'XML com CST 410 (sem gIBSCBS) deveria passar na validação de schema');
});

/**
 * vTroco (YA09) — NT 2016.002, regra YA09-10 (pesquisa de 2026-07-19,
 * fonte: nfe.fazenda.gov.br): exigido quando Σ(vPag) > vNF, fórmula
 * vTroco = Σ(vPag) - vNF. venda.pagamentos[].valor guarda o valor LÍQUIDO
 * (nunca o tenderizado) — ver comentário de montarGrupoPagamento.
 */
test('gerarXmlNfce: venda sem troco (padrão) não inclui <vTroco> — vPag continua igual ao valor líquido do pagamento', () => {
  const { venda } = montarVendaDeTeste();
  const { xml } = gerarXmlNfce(venda);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
  const pag = parser.parse(xml).NFe.infNFe.pag;

  assert.equal(pag.vTroco, undefined, 'sem troco, vTroco não deve aparecer no XML');
  assert.equal(pag.detPag.vPag, '27.90');
});

test('gerarXmlNfce: venda com troco em dinheiro — vPag do dinheiro vem TENDERIZADO (líquido + troco) e vTroco reflete exatamente o troco, Σ(vPag) - vNF = vTroco', () => {
  const { venda } = montarVendaDeTeste();
  venda.troco = 8; // cliente pagou 35.90 por uma compra de 27.90
  venda.pagamentos = [{ forma: 'dinheiro', valor: 27.9 }]; // valor LÍQUIDO — nunca o tenderizado (ver venda.service.registrar)

  const { xml } = gerarXmlNfce(venda);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
  const pag = parser.parse(xml).NFe.infNFe.pag;

  assert.equal(pag.vTroco, '8.00');
  assert.equal(pag.detPag.tPag, '01');
  assert.equal(pag.detPag.vPag, '35.90', 'vPag deve ser o valor TENDERIZADO (líquido + troco), não o líquido puro');
  assert.equal(Number(pag.detPag.vPag) - Number(pag.vTroco), 27.9, 'Σ(vPag) - vTroco deve bater com vNF (fórmula oficial YA09-10)');
});

test('gerarXmlNfce: venda com troco > 0 mas pagamento em cartão (não dinheiro) — inconsistência, lança em vez de inflar o pagamento errado', () => {
  const { venda } = montarVendaDeTeste();
  venda.troco = 8;
  venda.pagamentos = [{ forma: 'credito', valor: 27.9 }];

  assert.throws(
    () => gerarXmlNfce(venda),
    (err) => err.status === 500 && /troco.*sem pagamento em dinheiro/.test(err.message)
  );
});

test('gerarXmlNfce: XML com troco em dinheiro passa limpo na validação de schema real da lib (@nfewizard/nfce)', async () => {
  const { venda } = montarVendaDeTeste('real');
  venda.troco = 12.5;
  venda.pagamentos = [{ forma: 'dinheiro', valor: 27.9 }];

  const { xml, chaveAcesso } = gerarXmlNfce(venda);
  await assert.doesNotReject(() => NFE_SchemaValidate(comIdESignatureFicticios(xml, chaveAcesso), 'NFEAutorizacao'), 'XML com vTroco deveria passar na validação de schema padrão');
});

test('gerarXmlNfce: múltiplos pagamentos com troco — infla especificamente a entrada de dinheiro, não a primeira do array', () => {
  const { venda } = montarVendaDeTeste();
  venda.total = 50;
  venda.troco = 10;
  venda.pagamentos = [{ forma: 'credito', valor: 20 }, { forma: 'dinheiro', valor: 30 }]; // dinheiro NÃO é o primeiro

  const { xml } = gerarXmlNfce(venda);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
  const detPag = parser.parse(xml).NFe.infNFe.pag.detPag;

  assert.equal(detPag[0].tPag, '03');
  assert.equal(detPag[0].vPag, '20.00', 'pagamento em crédito não deve ser tocado pelo troco');
  assert.equal(detPag[1].tPag, '01');
  assert.equal(detPag[1].vPag, '40.00', 'só a entrada de dinheiro (índice 1, não a primeira) deve ser inflada pelo troco');
});
