/**
 * Arquivo: nfceContingenciaTransmissao.service.js
 * Responsabilidade: Transmitir à SEFAZ a NFC-e de contingência off-line
 * (tpEmis=9) já montada e assinada FORA do backend — pelo app ASSINATURA
 * da loja, no momento da venda, via xml-crypto/node-forge (ver
 * vigia-pdv/src/renderer/services/nfceContingencia.js e
 * vigia-pdv-assinatura/src/main/servidor/servidorAssinatura.js).
 *
 * NÃO monta nem assina nada aqui — transmite venda.xmlNfce EXATAMENTE como
 * chegou da sincronização (ver venda.service.registrar, nota sobre
 * `opcoes.contingencia`).
 *
 * POR QUE NÃO USA @nfewizard/nfce (NFCEWizard, já usado em
 * nfceEmissao.service.js pro fluxo normal): NFCEWizard.NFCE_Autorizacao,
 * ao receber uma string XML, "é convertida para JSON antes de seguir o
 * fluxo normal" (confirmado no .d.ts da lib) — ou seja, ela RECONSTRÓI e
 * RE-ASSINA o XML internamente com o certificado carregado no Environment,
 * em vez de transmitir a string recebida como está. Isso produziria um
 * documento DIFERENTE (chave de acesso, assinatura e QR Code diferentes)
 * do que já foi entregue ao cliente no cupom no momento da venda —
 * inaceitável em contingência, cujo propósito é justamente preservar o
 * documento que já circulou. Por isso este arquivo fala SOAP diretamente
 * com o webservice de autorização da UF, sem NFCEWizard nem nenhuma outra
 * lib (checado: @vexta-systems/node-mde, já usado no projeto, só cobre
 * Distribuição DF-e e Recepção de Evento — não Autorização).
 *
 * FORMATO DO ENVELOPE SOAP — ATENÇÃO, PENDÊNCIA REAL: estrutura pesquisada
 * e cruzada contra múltiplas implementações de mercado ativamente
 * mantidas (nfephp-org/sped-nfe, ACBr, DFe.NET, wmixvideo/nfe — todas
 * convergem no mesmo formato: SOAP 1.2, Header com nfeCabecMsg{cUF,
 * versaoDados}, Body com nfeDadosMsg > enviNFe{idLote, indSinc, NFe}).
 * NÃO FOI TESTADA CONTRA UM AMBIENTE REAL (homologação ou produção) nesta
 * sessão — sem acesso de rede confiável a domínios .gov.br neste ambiente
 * de desenvolvimento, e sem certificado real disponível pra teste (só o
 * de scripts/seedCertificadoTeste.js, que é fictício e não seria aceito
 * pela SEFAZ de verdade). ANTES DE OPERAR EM PRODUÇÃO: validar de fato
 * contra a homologação da SEFAZ-PR com um certificado real de testes.
 *
 * SEM CONTINGÊNCIA SVC AQUI TAMBÉM (mesma decisão documentada em
 * nfceEmissao.service.js): se a SEFAZ do estado emissor estiver fora do
 * ar bem na hora de transmitir, esta função só propaga a falha; quem
 * chama (filaTransmissaoContingencia.service.js) agenda retry no MESMO
 * endpoint, até a SEFAZ do estado voltar.
 *
 * Utilizado por: filaTransmissaoContingencia.service.js (worker
 * assíncrono).
 * Depende de: VendaRepository, SuperadminRepository, AuditoriaRepository,
 * config/webservicesSefaz, sefaz.service (CODIGO_UF), utils/certcrypto,
 * fast-xml-parser (parse da resposta SOAP), node:https.
 */
const https = require('https');
const { XMLParser } = require('fast-xml-parser');
const vendaRepo = require('../repositories/venda.repository');
const superadminRepo = require('../repositories/superadmin.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { resolverUrlsFiscais } = require('../config/webservicesSefaz');
const { CODIGO_UF } = require('./sefaz.service');
const { descriptografar, descriptografarTexto } = require('../utils/certcrypto');
const { AppError } = require('../utils/response');

const NAMESPACE_SERVICO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4';
const NAMESPACE_NFE = 'http://www.portalfiscal.inf.br/nfe';
const VERSAO_DADOS = '4.00';
const TIMEOUT_MS = 30000;

// Mesma lista de assinaturas de falha de CONEXÃO usada em
// nfceEmissao.service.js (ehFalhaDeRede) — aqui os erros vêm direto do
// módulo https/timeout desta função, não de uma lib terceira, mas a
// classificação por mensagem continua necessária pra distinguir "não deu
// pra falar com a SEFAZ" (retry) de "a SEFAZ respondeu recusando" (não
// retry automático).
const REGEX_ERRO_REDE = /EPROTO|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNABORTED|Network Error|timeout|socket hang up/i;

function mockAtivo() {
  return process.env.SEFAZ_MOCK === 'true' || process.env.NODE_ENV === 'test';
}

function ehFalhaDeRede(erro) {
  return REGEX_ERRO_REDE.test(erro.message || '');
}

/**
 * Envelope SOAP 1.2 com o XML já assinado embutido em enviNFe/indSinc=1
 * (autorização síncrona — resposta já vem com o resultado, sem precisar
 * de uma segunda consulta por recibo). Remove a declaração <?xml...?> do
 * XML recebido antes de embuti-lo (ele já chega com a própria, de
 * nfceContingencia.js no PDV — um XML não pode ter duas declarações).
 */
function montarEnvelopeSoap(xmlAssinado, cUF, idLote) {
  const nfeSemDeclaracao = String(xmlAssinado).replace(/^<\?xml[^>]*\?>\s*/i, '');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    '<soap12:Header>' +
    `<nfeCabecMsg xmlns="${NAMESPACE_SERVICO}"><cUF>${cUF}</cUF><versaoDados>${VERSAO_DADOS}</versaoDados></nfeCabecMsg>` +
    '</soap12:Header>' +
    '<soap12:Body>' +
    `<nfeDadosMsg xmlns="${NAMESPACE_SERVICO}">` +
    `<enviNFe xmlns="${NAMESPACE_NFE}" versao="${VERSAO_DADOS}"><idLote>${idLote}</idLote><indSinc>1</indSinc>${nfeSemDeclaracao}</enviNFe>` +
    '</nfeDadosMsg>' +
    '</soap12:Body>' +
    '</soap12:Envelope>'
  );
}

/** Busca recursiva por uma chave em um objeto/array de profundidade arbitrária — mesmo padrão já usado em nfceEmissao.service.js (buscarChaveProfunda) pra navegar um retorno de formato variável. */
function buscarChaveProfunda(obj, chave) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (chave in obj) return obj[chave];
  for (const valor of Object.values(obj)) {
    const encontrado = buscarChaveProfunda(valor, chave);
    if (encontrado !== undefined) return encontrado;
  }
  return undefined;
}

function postSoap(url, envelopeXml, agenteHttps) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (e) {
      reject(new Error('URL de autorização inválida: ' + url));
      return;
    }
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        agent: agenteHttps,
        timeout: TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(envelopeXml),
        },
      },
      (res) => {
        let corpo = '';
        res.on('data', (chunk) => { corpo += chunk; });
        res.on('end', () => resolve(corpo));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout ao transmitir contingência à SEFAZ')));
    req.on('error', reject);
    req.write(envelopeXml);
    req.end();
  });
}

/** MOCK — sucesso determinístico, sem rede, sem certificado real (mesmo padrão de nfceEmissao.service.js.chamarWebserviceMock). */
async function chamarWebserviceMock() {
  return { cStat: '100', xMotivo: 'Autorizado o uso da NF-e (MOCK CONTINGÊNCIA)', protocolo: 'MOCKCONT' + String(Date.now()).slice(-12) };
}

/**
 * REAL — SOAP 1.2 + mTLS direto (ver notas do topo do arquivo sobre por
 * que não usa NFCEWizard). `url` é a URL de autorização já resolvida pra
 * UF/ambiente do tenant (resolverUrlsFiscais).
 * A resposta é parseada com XMLParser (removeNSPrefix pra ignorar o
 * prefixo soap12:) e a busca por infProt é PRIORIZADA sobre uma busca
 * genérica por cStat: o retorno de uma autorização síncrona (indSinc=1)
 * tem cStat tanto no nível do LOTE (ex: 104="lote processado", campo
 * direto de retEnviNFe) quanto no nível do DOCUMENTO (o que realmente
 * importa, dentro de protNFe/infProt) — pegar o primeiro cStat encontrado
 * por uma busca profunda ingênua pegaria o do lote, não o do documento
 * (mesmo raciocínio já usado em nfceEmissao.service.js, que extrai
 * especificamente xmls[0].protNFe.infProt). Sem infProt no retorno
 * (provável rejeição do lote inteiro, sem processar nenhum documento),
 * cai para uma busca no nível mais alto da resposta.
 */
async function chamarWebserviceReal(url, xmlAssinado, tenant) {
  if (!tenant.certificadoPfx)
    throw new AppError('Este supermercado não tem certificado digital cadastrado', 422);

  const pfx = descriptografar(Buffer.from(tenant.certificadoPfx));
  const passphrase = tenant.certificadoSenha ? descriptografarTexto(tenant.certificadoSenha) : '';
  const agente = new https.Agent({ pfx, passphrase });

  const cUF = CODIGO_UF[tenant.uf];
  if (!cUF) throw new AppError('UF do tenant inválida ou não configurada', 422);
  const idLote = String(Date.now()).slice(-15);

  const envelope = montarEnvelopeSoap(xmlAssinado, cUF, idLote);
  const respostaTexto = await postSoap(url, envelope, agente);

  const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
  const respostaJson = parser.parse(respostaTexto);

  const infProt = buscarChaveProfunda(respostaJson, 'infProt');
  const bloco = infProt || respostaJson;
  const cStat = buscarChaveProfunda(bloco, 'cStat');
  const xMotivo = buscarChaveProfunda(bloco, 'xMotivo');
  const nProt = buscarChaveProfunda(bloco, 'nProt');

  if (cStat === undefined)
    throw new Error('Resposta da SEFAZ sem cStat — formato inesperado: ' + respostaTexto.slice(0, 300));

  return { cStat: String(cStat), xMotivo: xMotivo !== undefined ? String(xMotivo) : '', protocolo: nProt !== undefined ? String(nProt) : '' };
}

/**
 * Transmite a NFC-e de contingência (já assinada) da venda pra SEFAZ, e
 * grava o resultado. `chamarWebservice(url, xmlAssinado, tenant)` é
 * injetável só pra teste (mesmo padrão de nfceEmissao.service.js); em uso
 * normal nem precisa ser passado — mock/real padrão escolhido sozinho.
 * cStat=100 (autorizado): marca 'emitido' + emitidoViaContingencia=true.
 * Qualquer outro cStat: rejeição de CONTEÚDO — lança AppError 422, quem
 * chama (filaTransmissaoContingencia) decide não reagendar retry (uma
 * rejeição de conteúdo não se resolve tentando de novo sem correção
 * manual). Falha de CONEXÃO propaga como exceção comum — quem chama
 * reagenda retry.
 */
async function transmitirContingencia(tenantId, vendaId, { chamarWebservice } = {}) {
  const tenant = await superadminRepo.buscarTenantPorId(tenantId);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);

  const venda = await vendaRepo.buscarXml(tenantId, vendaId);
  if (!venda) throw new AppError('Venda não encontrada', 404);
  if (!venda.xmlNfce || !venda.chaveNfce)
    throw new AppError('Venda não tem XML de contingência assinado para transmitir', 422);

  const urls = resolverUrlsFiscais(tenant.uf, tenant.ambienteFiscal);
  const chamador = chamarWebservice || (mockAtivo() ? chamarWebserviceMock : chamarWebserviceReal);

  const resultado = await chamador(urls.autorizacao, venda.xmlNfce, tenant);

  if (resultado.cStat === '100') {
    const atualizada = await vendaRepo.atualizarStatus(tenantId, vendaId, {
      statusEmissaoFiscal: 'emitido',
      emitidoViaContingencia: true,
      emitidoEm: new Date(),
      protocoloAutorizacao: resultado.protocolo,
    });
    await auditoriaRepo.registrar({
      tenantId, acao: 'transmitir_contingencia_nfce', entidade: 'Venda', entidadeId: vendaId,
      depois: { chaveNfce: venda.chaveNfce, protocolo: resultado.protocolo },
    });
    return atualizada;
  }

  throw new AppError(`NFC-e de contingência rejeitada pela SEFAZ ao transmitir: ${resultado.cStat} - ${resultado.xMotivo}`, 422);
}

module.exports = { transmitirContingencia, mockAtivo, ehFalhaDeRede, chamarWebserviceReal, montarEnvelopeSoap };
