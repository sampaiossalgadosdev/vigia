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

/**
 * Atualiza campos do caixa (id + tenantId sempre juntos no where — Fase 0).
 * Aceita `tx` como primeiro parâmetro (client Prisma padrão ou de dentro de
 * um $transaction, mesmo padrão de estoqueDeposito.repository.js) porque
 * venda.service.js precisa somar/reverter os totais do caixa tanto dentro
 * da transação de registrar() quanto fora dela em cancelar(). Reaproveitada
 * em vez de manter update direto sem tenantId nos dois pontos.
 */
async function atualizar(tx, tenantId, id, dados) {
  return tx.caixa.update({ where: { id, tenantId }, data: dados });
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

module.exports = { buscarAberto, abrir, fechar, criarMovimentacao, historico, contarHistorico, atualizar };