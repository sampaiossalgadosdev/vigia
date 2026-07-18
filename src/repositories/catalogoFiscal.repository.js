/**
 * Arquivo: catalogoFiscal.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para os catálogos
 * fiscais de referência (CatalogoNcm, CatalogoCfop, CatalogoCst,
 * CatalogoCsosn, CatalogoCstIbsCbs, CatalogoClassTrib) — dados reais de
 * fontes oficiais, nunca editados pela aplicação (só pelos scripts de
 * import em scripts/). Usado tanto para o autocomplete do cadastro de
 * produto (buscar*) quanto para a validação de existência (existe*).
 * "Vigente" em todo lugar aqui = dataFimVigencia nula OU no futuro — nunca
 * deixa escolher/validar um código já descontinuado na fonte oficial.
 * Utilizado por: ProdutoService (busca), ProdutoValidator (existência).
 */
const prisma = require('../config/database');

const LIMITE_BUSCA = 20;

function vigente(agora = new Date()) {
  return { OR: [{ dataFimVigencia: null }, { dataFimVigencia: { gte: agora } }] };
}

async function buscarNcm(termo) {
  if (!termo || termo.trim().length < 2) return [];
  const t = termo.trim();
  return prisma.catalogoNcm.findMany({
    where: { AND: [vigente(), { OR: [{ codigo: { startsWith: t } }, { descricao: { contains: t, mode: 'insensitive' } }] }] },
    select: { codigo: true, descricao: true },
    orderBy: { codigo: 'asc' },
    take: LIMITE_BUSCA,
  });
}

async function existeNcm(codigo) {
  return Boolean(await prisma.catalogoNcm.findFirst({ where: { codigo, ...vigente() }, select: { codigo: true } }));
}

async function buscarCfop(termo) {
  if (!termo || termo.trim().length < 1) return [];
  const t = termo.trim();
  return prisma.catalogoCfop.findMany({
    where: { AND: [vigente(), { OR: [{ codigo: { startsWith: t } }, { descricao: { contains: t, mode: 'insensitive' } }] }] },
    select: { codigo: true, descricao: true, tipoOperacao: true },
    orderBy: { codigo: 'asc' },
    take: LIMITE_BUSCA,
  });
}

async function existeCfop(codigo) {
  return Boolean(await prisma.catalogoCfop.findFirst({ where: { codigo, ...vigente() }, select: { codigo: true } }));
}

async function buscarCstIbsCbs(termo) {
  const t = (termo || '').trim();
  return prisma.catalogoCstIbsCbs.findMany({
    where: { AND: [vigente(), t ? { OR: [{ codigo: { startsWith: t } }, { descricao: { contains: t, mode: 'insensitive' } }] } : {}] },
    select: { codigo: true, descricao: true },
    orderBy: { codigo: 'asc' },
    take: LIMITE_BUSCA,
  });
}

async function existeCstIbsCbs(codigo) {
  return Boolean(await prisma.catalogoCstIbsCbs.findFirst({ where: { codigo, ...vigente() }, select: { codigo: true } }));
}

async function buscarClassTrib(termo) {
  const t = (termo || '').trim();
  return prisma.catalogoClassTrib.findMany({
    where: { AND: [vigente(), t ? { OR: [{ codigo: { startsWith: t } }, { descricao: { contains: t, mode: 'insensitive' } }] } : {}] },
    select: { codigo: true, descricao: true },
    orderBy: { codigo: 'asc' },
    take: LIMITE_BUSCA,
  });
}

async function existeClassTrib(codigo) {
  return Boolean(await prisma.catalogoClassTrib.findFirst({ where: { codigo, ...vigente() }, select: { codigo: true } }));
}

/**
 * Monta o objeto de classificação fiscal a partir de uma linha de
 * CatalogoCstIbsCbs + uma linha de CatalogoClassTrib já buscadas (por
 * findUnique individual ou por um mapa em lote — ver listarIndicadoresCst/
 * listarIndicadoresClassTrib abaixo). Extraído de buscarClassificacaoFiscal
 * pra ficar num lugar só: quem busca em lote (nfceEmissao.service.
 * itensComTributo, pdvSnapshot.service.js) não duplica esta montagem.
 * Retorna null se cst ou classTrib não existir (código sem correspondência
 * no catálogo).
 */
function montarClassificacaoFiscal(cst, classTrib) {
  if (!cst || !classTrib) return null;
  return {
    indGIbsCbs: cst.indGIbsCbs,
    indGRed: cst.indGRed,
    pRedIbs: classTrib.pRedIbs === null ? null : Number(classTrib.pRedIbs),
    pRedCbs: classTrib.pRedCbs === null ? null : Number(classTrib.pRedCbs),
  };
}

/**
 * Indicadores oficiais de estrutura/redução de alíquota pro par CST-IBS/CBS
 * + cClassTrib de um item (NT 2025.002-RTC, regras UB12-10/UB64-10/UB64-20/
 * UB65-10/UB66-10) — usado por tributoFiscal.service.calcularTributoItem
 * pra decidir se o grupo de valor (gIBSCBS) deve ser omitido (indGIbsCbs
 * false, ex.: CST 410) e se a redução de alíquota (gRed) se aplica
 * (indGRed true, ex.: CST 200 — os percentuais pRedIbs/pRedCbs vêm do
 * cClassTrib, não do CST). Retorna null se algum dos dois códigos não
 * existir no catálogo (não deveria acontecer pra um produto já validado no
 * cadastro — ver produto.validator.js — mas não presume). Busca individual
 * (1 par) — pra resolver vários produtos de uma vez, ver
 * listarIndicadoresCst/listarIndicadoresClassTrib + montarClassificacaoFiscal.
 */
async function buscarClassificacaoFiscal(cstIbsCbs, cClassTrib) {
  const [cst, classTrib] = await Promise.all([
    prisma.catalogoCstIbsCbs.findUnique({ where: { codigo: cstIbsCbs }, select: { indGIbsCbs: true, indGRed: true } }),
    prisma.catalogoClassTrib.findUnique({ where: { codigo: cClassTrib }, select: { pRedIbs: true, pRedCbs: true } }),
  ]);
  return montarClassificacaoFiscal(cst, classTrib);
}

/**
 * Tabela CatalogoCstIbsCbs inteira (18 códigos hoje, global — não é
 * por tenant), só os indicadores. Pensada pra montagem em lote (ex.:
 * pdvSnapshot.service.js, que resolve a classificação de um catálogo de
 * produto inteiro de uma vez) — evita N chamadas a buscarClassificacaoFiscal
 * (uma por produto) quando o chamador pode montar o mapa uma vez só.
 */
async function listarIndicadoresCst() {
  return prisma.catalogoCstIbsCbs.findMany({ select: { codigo: true, indGIbsCbs: true, indGRed: true } });
}

/** Mesma ideia de listarIndicadoresCst, para CatalogoClassTrib (164 códigos hoje). */
async function listarIndicadoresClassTrib() {
  return prisma.catalogoClassTrib.findMany({ select: { codigo: true, pRedIbs: true, pRedCbs: true } });
}

module.exports = {
  buscarNcm, existeNcm,
  buscarCfop, existeCfop,
  buscarCstIbsCbs, existeCstIbsCbs,
  buscarClassTrib, existeClassTrib,
  buscarClassificacaoFiscal,
  montarClassificacaoFiscal,
  listarIndicadoresCst,
  listarIndicadoresClassTrib,
};
