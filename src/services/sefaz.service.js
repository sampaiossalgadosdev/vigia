/**
 * Arquivo: sefaz.service.js
 * Responsabilidade: Toda a conversa com os Web Services da SEFAZ
 * (Distribuição DF-e e Manifestação do Destinatário) via
 * @vexta-systems/node-mde, usando o certificado A1 do tenant. O certificado
 * é descriptografado apenas em memória, no momento da chamada — nunca vai
 * pra disco nem pra log.
 * Utilizado por: NfeEntradaService.
 * Depende de: NfeDistribuicaoRepository, utils/certcrypto, utils/nfe.parser.
 */
const { DistribuicaoNFe, RecepcaoEvento } = require('@vexta-systems/node-mde');
const nfeDistRepo = require('../repositories/nfeDistribuicao.repository');
const { descriptografar, descriptografarTexto } = require('../utils/certcrypto');
const { parseNfe } = require('../utils/nfe.parser');
const { AppError } = require('../utils/response');
const logger = require('../logs/logger');

// Código IBGE de cada UF (cUFAutor exigido pela Distribuição DF-e).
const CODIGO_UF = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53', ES: '32',
  GO: '52', MA: '21', MT: '51', MS: '50', MG: '31', PA: '15', PB: '25', PR: '41',
  PE: '26', PI: '22', RJ: '33', RN: '24', RS: '43', RO: '11', RR: '14', SC: '42',
  SP: '35', SE: '28', TO: '17',
};

// Eventos de manifestação do destinatário → estado local.
const EVENTO_CIENCIA = 210210;
const MANIFESTACAO_POR_EVENTO = {
  210200: 'confirmada',
  210210: 'ciencia',
  210220: 'desconhecida',
  210240: 'nao_realizada',
};

const MAX_PAGINAS_SYNC = 20; // cada consulta devolve até 50 documentos

function tpAmb() {
  return (process.env.SEFAZ_AMBIENTE || 'producao') === 'homologacao' ? '2' : '1';
}

/**
 * Monta a configuração das chamadas à SEFAZ a partir do tenant, com o
 * certificado descriptografado em memória.
 */
function configSefaz(tenant) {
  if (!tenant.certificadoPfx)
    throw new AppError('Este supermercado não tem certificado digital cadastrado — solicite o cadastro ao administrador do sistema', 422);
  if (!tenant.uf || !CODIGO_UF[tenant.uf])
    throw new AppError('Este supermercado não tem UF cadastrada — solicite o cadastro ao administrador do sistema', 422);
  return {
    pfx: descriptografar(Buffer.from(tenant.certificadoPfx)),
    passphrase: tenant.certificadoSenha ? descriptografarTexto(tenant.certificadoSenha) : '',
    cnpj: tenant.cnpj,
    cUFAutor: CODIGO_UF[tenant.uf],
    tpAmb: tpAmb(),
    options: { requestOptions: { timeout: 60000 } },
  };
}

/** Série e número da NF-e vêm embutidos na chave de acesso (posições fixas). */
function serieNumeroDaChave(chave) {
  return { serie: String(Number(chave.slice(22, 25))), numero: String(Number(chave.slice(25, 34))) };
}

function decimalOuNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function dataOuNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Persiste um resumo de NF-e (resNFe) recebido da distribuição. */
async function processarResumo(tenantId, nsu, res) {
  const chave = String(res.chNFe || '');
  if (!/^\d{44}$/.test(chave)) return;
  await nfeDistRepo.upsertDocumento(tenantId, chave, {
    nsu,
    cnpjEmitente: res.CNPJ ? String(res.CNPJ) : res.CPF ? String(res.CPF) : undefined,
    nomeEmitente: res.xNome ? String(res.xNome) : undefined,
    dataEmissao: dataOuNull(res.dhEmi || res.dEmi) || undefined,
    valorTotal: decimalOuNull(res.vNF) ?? undefined,
    situacao: res.cSitNFe !== undefined ? String(res.cSitNFe) : undefined,
    ...serieNumeroDaChave(chave),
  });
}

/** Persiste uma NF-e completa (procNFe) recebida da distribuição. */
async function processarNfeCompleta(tenantId, nsu, xml) {
  let nota;
  try {
    nota = parseNfe(xml);
  } catch (e) {
    logger.error('Distribuição DF-e: procNFe não parseável', { tenantId, nsu, erro: e.message });
    return;
  }
  await nfeDistRepo.upsertDocumento(tenantId, nota.chaveAcesso, {
    nsu,
    cnpjEmitente: nota.emitente.cnpj || undefined,
    nomeEmitente: nota.emitente.nome,
    dataEmissao: nota.dataEmissao,
    valorTotal: decimalOuNull(nota.valorTotal) ?? undefined,
    situacao: '1', // XML completo só é distribuído para nota autorizada
    natureza: extrairNatOp(xml),
    xmlCompleto: xml,
    ...serieNumeroDaChave(nota.chaveAcesso),
  });
}

/** natOp fica fora do que o parseNfe retorna; extração pontual e tolerante. */
function extrairNatOp(xml) {
  const m = String(xml).match(/<natOp>([^<]{1,120})<\/natOp>/);
  return m ? m[1] : undefined;
}

/** Atualiza o status de manifestação a partir de um resEvento/procEvento. */
async function processarEvento(tenantId, json) {
  const ev = json.resEvento || (json.procEventoNFe && json.procEventoNFe.retEvento && json.procEventoNFe.retEvento.infEvento) || null;
  const chave = ev && String(ev.chNFe || '');
  const tpEvento = ev && Number(ev.tpEvento);
  const manifestacao = MANIFESTACAO_POR_EVENTO[tpEvento];
  if (!chave || !/^\d{44}$/.test(chave) || !manifestacao) return;
  const existente = await nfeDistRepo.buscarPorChave(tenantId, chave);
  if (existente) await nfeDistRepo.atualizar(existente.id, { manifestacao });
}

/**
 * Sincroniza a Distribuição DF-e: consome os NSUs a partir do cursor
 * Tenant.ultimoNsu, persiste resumos/XMLs/eventos e avança o cursor.
 * cStat da SEFAZ: 138 = documentos localizados, 137 = nada novo,
 * 656 = consumo indevido (bloqueio temporário de ~1h).
 */
async function sincronizar(tenant) {
  const distribuicao = new DistribuicaoNFe(configSefaz(tenant));
  let ultNSU = tenant.ultimoNsu || '0';
  let paginas = 0;
  let novos = 0;

  while (paginas < MAX_PAGINAS_SYNC) {
    paginas += 1;
    const consulta = await distribuicao.consultaUltNSU(ultNSU.padStart(15, '0'));
    if (consulta.error)
      throw new AppError('Falha na comunicação com a SEFAZ: ' + JSON.stringify(consulta.error).slice(0, 200), 502);

    const dados = consulta.data || {};
    const cStat = String(dados.cStat || '');
    if (cStat === '656')
      throw new AppError('A SEFAZ bloqueou temporariamente as consultas deste CNPJ por excesso de requisições (consumo indevido). Tente novamente em 1 hora.', 429);
    if (cStat === '137') break; // nenhum documento novo
    if (cStat !== '138')
      throw new AppError('SEFAZ retornou um erro na consulta: ' + cStat + ' - ' + (dados.xMotivo || 'sem detalhe'), 502);

    for (const doc of dados.docZip || []) {
      const schema = String(doc.schema || '');
      if (schema.startsWith('resNFe')) await processarResumo(tenant.id, doc.nsu, (doc.json && doc.json.resNFe) || {});
      else if (schema.startsWith('procNFe')) await processarNfeCompleta(tenant.id, doc.nsu, doc.xml);
      else if (schema.startsWith('resEvento') || schema.startsWith('procEventoNFe')) await processarEvento(tenant.id, doc.json || {});
      novos += 1;
    }

    ultNSU = String(dados.ultNSU || ultNSU);
    await nfeDistRepo.atualizarUltimoNsu(tenant.id, ultNSU);
    if (!dados.maxNSU || Number(dados.ultNSU) >= Number(dados.maxNSU)) break;
  }

  return { documentosRecebidos: novos, ultimoNsu: ultNSU };
}

/**
 * Envia a manifestação (padrão: Ciência da Operação) pras chaves informadas.
 * Retorna um mapa chave → { ok, motivo }. cStat 135/136 = evento registrado;
 * 573 = evento duplicado (já manifestada antes — tratado como sucesso).
 */
async function manifestar(tenant, chaves, tipoEvento = EVENTO_CIENCIA) {
  const recepcao = new RecepcaoEvento(configSefaz(tenant));
  const resultado = {};

  for (let i = 0; i < chaves.length; i += 20) { // limite de 20 eventos por lote
    const lote = chaves.slice(i, i + 20).map((chNFe) => ({ chNFe, tipoEvento }));
    const envio = await recepcao.enviarEvento({ idLote: String(Date.now() % 1e15), lote });
    if (envio.error)
      throw new AppError('Falha ao enviar manifestação à SEFAZ: ' + JSON.stringify(envio.error).slice(0, 200), 502);

    const retornos = [].concat((envio.data && envio.data.retEvento) || []);
    for (const ret of retornos) {
      const info = ret.infEvento || ret;
      const chave = String(info.chNFe || '');
      const cStat = String(info.cStat || '');
      resultado[chave] = ['135', '136', '573'].includes(cStat)
        ? { ok: true }
        : { ok: false, motivo: cStat + ' - ' + (info.xMotivo || 'evento rejeitado') };
    }
  }
  return resultado;
}

/** Baixa o XML completo (procNFe) de uma nota já manifestada. */
async function baixarXml(tenant, chaveAcesso) {
  const distribuicao = new DistribuicaoNFe(configSefaz(tenant));
  const consulta = await distribuicao.consultaChNFe(chaveAcesso);
  if (consulta.error)
    throw new AppError('Falha ao baixar o XML na SEFAZ: ' + JSON.stringify(consulta.error).slice(0, 200), 502);
  const doc = ((consulta.data && consulta.data.docZip) || []).find((d) => String(d.schema || '').startsWith('procNFe'));
  if (!doc)
    throw new AppError('A SEFAZ ainda não liberou o XML completo desta nota (a liberação pode levar alguns minutos após a manifestação)', 422);
  return doc.xml;
}

module.exports = { sincronizar, manifestar, baixarXml, EVENTO_CIENCIA, CODIGO_UF };
