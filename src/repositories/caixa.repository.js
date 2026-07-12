const prisma = require('../config/database');

async function buscarAberto(tenantId) {
  return prisma.caixa.findFirst({ where: { tenantId, status: 'aberto' }, orderBy: { abertoEm: 'desc' } });
}

async function abrir(dados) {
  return prisma.caixa.create({ data: dados });
}

async function fechar(tenantId, id, dados) {
  return prisma.caixa.update({ where: { id, tenantId }, data: dados });
}

async function criarMovimentacao(dados) {
  return prisma.sangria.create({ data: dados });
}

async function historico(tenantId, { skip, take }) {
  return prisma.caixa.findMany({ where: { tenantId, status: 'fechado' }, skip, take, orderBy: { fechadoEm: 'desc' } });
}

async function contarHistorico(tenantId) {
  return prisma.caixa.count({ where: { tenantId, status: 'fechado' } });
}

module.exports = { buscarAberto, abrir, fechar, criarMovimentacao, historico, contarHistorico };