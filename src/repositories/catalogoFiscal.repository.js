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

module.exports = {
  buscarNcm, existeNcm,
  buscarCfop, existeCfop,
  buscarCstIbsCbs, existeCstIbsCbs,
  buscarClassTrib, existeClassTrib,
};
