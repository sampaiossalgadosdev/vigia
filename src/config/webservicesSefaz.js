/**
 * Arquivo: webservicesSefaz.js
 * Responsabilidade: Tabela UF → URLs dos webservices de NFC-e (autorização,
 * consulta de protocolo, consulta pública/QR Code) e do ambiente de
 * contingência nacional (SVC), mais o prazo de cancelamento por UF.
 * Utilizado por: nfceEmissao.service (Fase 1c).
 *
 * FONTE: URLs de autorização/consulta/QR Code de NFC-e (modelo 65),
 * versão 4.00, extraídas do arquivo ACBrNFeServicos.ini do projeto ACBr
 * (github.com/frones/ACBr) — referência comunitária ativamente mantida e
 * amplamente usada por ERPs brasileiros pra esses endpoints. NÃO foram
 * inventadas. A extração foi feita por busca/resumo automatizado do
 * arquivo, não um parse byte-a-byte — recomenda-se conferir contra o .ini
 * original (ou o Portal Nacional da NF-e) antes de qualquer emissão real
 * em produção, e resincronizar periodicamente (infraestrutura de estado
 * muda: migração pra SVAN, troca de domínio, etc.).
 *
 * PENDENTE DE CONFIRMAÇÃO — sinalizado explicitamente, não escondido:
 *  1. Contingência (SVC): usamos o SVC-RS (SVRS) pra TODOS os estados por
 *     ser a URL mais amplamente documentada. Alguns estados são
 *     oficialmente designados pro SVC-AN em vez do SVC-RS — essa
 *     distribuição específica por UF precisa ser confirmada contra o
 *     Portal Nacional antes de produção (não afeta o funcionamento em si,
 *     é sobre usar o SVC "oficialmente correto" pra cada estado).
 *  2. Um punhado de UFs (AL, MG, MS, PR, RJ, RS) só tiveram UMA url de QR
 *     Code localizada na fonte (sem uma variante de homologação
 *     claramente distinta) — usamos a mesma pra produção e homologação
 *     nesses casos; confirme se há uma URL de homologação própria antes
 *     de operar em produção nesses estados.
 *  3. Janela de cancelamento: 30 minutos é o valor NACIONALMENTE
 *     padronizado pra NFC-e (modelo 65) hoje — diferente da NF-e (modelo
 *     55), que varia mais por estado. Não encontramos exceção confirmada
 *     por estado especificamente pra NFC-e; ainda assim, confirme contra
 *     a legislação de cada UF antes de produção (isso pode mudar).
 */

// Contingência nacional (SVC): quando a SEFAZ do estado emissor está fora
// do ar, a autorização passa a ser feita por um ambiente virtual
// (SVC-AN ou SVC-RS) — ver PENDENTE DE CONFIRMAÇÃO #1 acima.
const SVC = {
  producao: {
    autorizacao: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    consultaProtocolo: 'https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  },
  homologacao: {
    autorizacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    consultaProtocolo: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  },
};

// Estados cuja autorização de NFC-e é feita via SVRS como PROVEDOR
// PRIMÁRIO (não é contingência pra eles — SVRS já é a infraestrutura do
// dia a dia). URLs idênticas às do bloco SVC acima.
const VIA_SVRS = SVC;

const JANELA_CANCELAMENTO_PADRAO_MINUTOS = 30;

const WEBSERVICES_SEFAZ = {
  AC: { ...clonarComQr(VIA_SVRS, 'http://www.sefaznet.ac.gov.br/nfce/qrcode', 'http://www.hml.sefaznet.ac.gov.br/nfce/qrcode') },
  AL: { ...clonarComQr(VIA_SVRS, 'http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp', 'http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp') },
  AP: { ...clonarComQr(VIA_SVRS, 'https://www.sefaz.ap.gov.br/nfce/nfcep.php', 'https://www.sefaz.ap.gov.br/nfcehml/nfce.php') },
  AM: {
    producao: {
      autorizacao: 'https://nfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4',
      consultaProtocolo: 'https://nfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4',
      qrcode: 'http://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp',
    },
    homologacao: {
      autorizacao: 'https://homnfce.sefaz.am.gov.br/nfce-services-nac/services/NfeAutorizacao4',
      consultaProtocolo: 'https://homnfce.sefaz.am.gov.br/nfce-services-nac/services/NfeConsulta4',
      qrcode: 'http://homnfce.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp',
    },
  },
  BA: { ...clonarComQr(VIA_SVRS, 'http://nfe.sefaz.ba.gov.br/servicos/nfce/modulos/geral/NFCEC_consulta_chave_acesso.aspx', 'http://hnfe.sefaz.ba.gov.br/servicos/nfce/modulos/geral/NFCEC_consulta_chave_acesso.aspx') },
  CE: { ...clonarComQr(VIA_SVRS, 'http://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html', 'http://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html') },
  DF: { ...clonarComQr(VIA_SVRS, 'http://www.fazenda.df.gov.br/nfce/qrcode', 'http://dec.fazenda.df.gov.br/ConsultarNFCe.aspx') },
  ES: { ...clonarComQr(VIA_SVRS, 'http://app.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx', 'http://homologacao.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx') },
  GO: {
    producao: {
      autorizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4?wsdl',
      consultaProtocolo: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4?wsdl',
      qrcode: 'https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe',
    },
    homologacao: {
      autorizacao: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4?wsdl',
      consultaProtocolo: 'https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4?wsdl',
      qrcode: 'https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe',
    },
  },
  MA: { ...clonarComQr(VIA_SVRS, 'http://www.nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp', 'http://www.hom.nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp') },
  MG: {
    producao: {
      autorizacao: 'https://nfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4',
      consultaProtocolo: 'https://nfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4',
      qrcode: 'https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml',
    },
    homologacao: {
      autorizacao: 'https://hnfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4',
      consultaProtocolo: 'https://hnfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4',
      qrcode: 'https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml', // ver pendência #2
    },
  },
  MS: {
    producao: {
      autorizacao: 'https://nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4',
      consultaProtocolo: 'https://nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4',
      qrcode: 'http://www.dfe.ms.gov.br/nfce/qrcode',
    },
    homologacao: {
      autorizacao: 'https://hom.nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4',
      consultaProtocolo: 'https://hom.nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4',
      qrcode: 'http://www.dfe.ms.gov.br/nfce/qrcode', // ver pendência #2
    },
  },
  MT: {
    producao: {
      autorizacao: 'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4',
      consultaProtocolo: 'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4',
      qrcode: 'http://www.sefaz.mt.gov.br/nfce/consultanfce',
    },
    homologacao: {
      autorizacao: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4',
      consultaProtocolo: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeConsulta4',
      qrcode: 'http://homologacao.sefaz.mt.gov.br/nfce/consultanfce',
    },
  },
  PA: { ...clonarComQr(VIA_SVRS, 'https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam', 'https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam') },
  PB: { ...clonarComQr(VIA_SVRS, 'http://www.sefaz.pb.gov.br/nfce', 'http://www.sefaz.pb.gov.br/nfcehom') },
  PE: { ...clonarComQr(VIA_SVRS, 'http://nfce.sefaz.pe.gov.br/nfce-web/consultarNFCe', 'http://nfcehomolog.sefaz.pe.gov.br/nfce-web/consultarNFCe') },
  PI: { ...clonarComQr(VIA_SVRS, 'http://webas.sefaz.pi.gov.br/nfceweb/consultarNFCe.jsf', 'http://webas.sefaz.pi.gov.br/nfceweb-homologacao/consultarNFCe.jsf') },
  PR: {
    producao: {
      autorizacao: 'https://nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4',
      consultaProtocolo: 'https://nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4',
      qrcode: 'http://www.dfeportal.fazenda.pr.gov.br/dfe-portal/rest/servico/consultaNFCe',
    },
    homologacao: {
      autorizacao: 'https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4',
      consultaProtocolo: 'https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4',
      qrcode: 'http://www.dfeportal.fazenda.pr.gov.br/dfe-portal/rest/servico/consultaNFCe', // ver pendência #2
    },
  },
  RJ: { ...clonarComQr(VIA_SVRS, 'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode', 'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode') }, // ver pendência #2
  RN: { ...clonarComQr(VIA_SVRS, 'http://nfce.set.rn.gov.br/consultarNFCe.aspx', 'http://hom.nfce.set.rn.gov.br/consultarNFCe.aspx') },
  RO: { ...clonarComQr(VIA_SVRS, 'http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp', 'http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp') },
  RS: {
    producao: {
      autorizacao: 'https://nfce.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
      consultaProtocolo: 'https://nfce.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
      qrcode: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx',
    },
    homologacao: {
      autorizacao: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
      consultaProtocolo: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
      qrcode: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', // ver pendência #2
    },
  },
  RR: { ...clonarComQr(VIA_SVRS, 'https://www.sefaz.rr.gov.br/nfce/servlet/qrcode', 'http://200.174.88.103:8080/nfce/servlet/qrcode') },
  SC: { ...clonarComQr(VIA_SVRS, 'https://sat.sef.sc.gov.br/nfce/consulta?p=', 'https://hom.sat.sef.sc.gov.br/nfce/consulta?p=') },
  SE: { ...clonarComQr(VIA_SVRS, 'http://www.nfce.se.gov.br/portal/consultarNFCe.jsp', 'http://www.hom.nfe.se.gov.br/portal/consultarNFCe.jsp') },
  SP: {
    producao: {
      autorizacao: 'https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
      consultaProtocolo: 'https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
      qrcode: 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx',
    },
    homologacao: {
      autorizacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
      consultaProtocolo: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
      qrcode: 'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx',
    },
  },
  TO: { ...clonarComQr(VIA_SVRS, 'http://apps.sefaz.to.gov.br/portal-nfce/qrcodeNFCe', 'http://apps.sefaz.to.gov.br/portal-nfce-homologacao/qrcodeNFCe') },
};

/** Clona o bloco base (autorização/consulta) de contingência/SVRS e adiciona o QR Code de cada ambiente. */
function clonarComQr(base, qrProducao, qrHomologacao) {
  return {
    producao: { ...base.producao, qrcode: qrProducao },
    homologacao: { ...base.homologacao, qrcode: qrHomologacao },
  };
}

// Janela de cancelamento por UF — hoje todos usam o padrão nacional de
// NFC-e (30 min); mapa deixado explícito (em vez de só uma constante)
// pra já existir o lugar certo de sobrescrever um estado específico assim
// que alguma exceção for confirmada (ver pendência #3 no topo do arquivo).
const JANELA_CANCELAMENTO_MINUTOS_POR_UF = Object.keys(WEBSERVICES_SEFAZ).reduce((acc, uf) => {
  acc[uf] = JANELA_CANCELAMENTO_PADRAO_MINUTOS;
  return acc;
}, {});

/**
 * Resolve as URLs de webservice e a janela de cancelamento pra uma UF e um
 * ambiente ('producao' | 'homologacao'). Lança erro se a UF não existir na
 * tabela (27 UFs cobertas) ou o ambiente for inválido.
 */
function resolverUrlsFiscais(uf, ambiente = 'homologacao') {
  const entrada = WEBSERVICES_SEFAZ[uf];
  if (!entrada) throw new Error(`UF desconhecida ou não cadastrada na tabela de webservices: ${uf}`);
  if (ambiente !== 'producao' && ambiente !== 'homologacao')
    throw new Error(`Ambiente fiscal inválido: ${ambiente}`);

  const bloco = entrada[ambiente];
  const svc = SVC[ambiente];
  return {
    autorizacao: bloco.autorizacao,
    consulta: bloco.consultaProtocolo,
    qrcode: bloco.qrcode,
    contingenciaSvc: { autorizacao: svc.autorizacao, consultaProtocolo: svc.consultaProtocolo },
    janelaCancelamentoMinutos: JANELA_CANCELAMENTO_MINUTOS_POR_UF[uf] ?? JANELA_CANCELAMENTO_PADRAO_MINUTOS,
  };
}

module.exports = { resolverUrlsFiscais, WEBSERVICES_SEFAZ, JANELA_CANCELAMENTO_PADRAO_MINUTOS };
