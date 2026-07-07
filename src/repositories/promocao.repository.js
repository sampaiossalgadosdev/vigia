const prisma = require('../config/database');

async function listar(tenantId, { ativa, produtoId }) {
  const where = { tenantId };
  if (ativa !== undefined) where.ativa = ativa === 'true';
  if (produtoId) where.produtoId = produtoId;
  return prisma.promocao.findMany({ where, orderBy: [{ ativa: 'desc' }, { dataFim: 'asc' }], include: { produto: { select: { id: true, nome: true, ean: true, preco: true } } } });
}

async function buscarPorId(tenantId, id) {
  return prisma.promocao.findFirst({ where: { id, tenantId }, include: { produto: true } });
}

async function buscarAtivaPorProduto(tenantId, produtoId) {
  const agora = new Date();
  return prisma.promocao.findFirst({ where: { tenantId, produtoId, ativa: true, dataInicio: { lte: agora }, dataFim: { gte: agora } } });
}

async function criar(dados) {
  return prisma.promocao.create({ data: dados, include: { produto: true } });
}

async function atualizar(id, dados) {
  return prisma.promocao.update({ where: { id }, data: dados, include: { produto: true } });
}

async function encerrar(id) {
  return prisma.promocao.update({ where: { id }, data: { ativa: false }, include: { produto: true } });
}

async function vigentes(tenantId) {
  const agora = new Date();
  return prisma.promocao.findMany({ where: { tenantId, ativa: true, dataInicio: { lte: agora }, dataFim: { gte: agora } }, include: { produto: true } });
}

module.exports = { listar, buscarPorId, buscarAtivaPorProduto, criar, atualizar, encerrar, vigentes };