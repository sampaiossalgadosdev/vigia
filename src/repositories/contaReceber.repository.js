/**
 * Arquivo: contaReceber.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para ContaReceber
 * (Fase 4a). Só operações mecânicas — regra de negócio fica em
 * contaReceber.service.js.
 * Utilizado por: ContaReceberService.
 */
const prisma = require('../config/database');

/**
 * Filtros por status e por período de vencimento: `vencidas=true` lista
 * abertas com vencimento no passado; `dias` lista abertas vencendo dentro
 * dos próximos N dias. Combinam com um `status` explícito quando informado.
 */
function filtroListagem(tenantId, { status, vencidas, dias }) {
  const where = { tenantId };
  if (status) where.status = status;

  const agora = new Date();
  if (vencidas === 'true' || vencidas === true) {
    if (!status) where.status = 'aberto';
    where.dataVencimento = { lt: agora };
  } else if (dias !== undefined && dias !== '') {
    const limite = new Date(agora.getTime() + Number(dias) * 24 * 60 * 60 * 1000);
    if (!status) where.status = 'aberto';
    where.dataVencimento = { gte: agora, lte: limite };
  }
  return where;
}

async function criar(dados) {
  return prisma.contaReceber.create({ data: dados });
}

async function listar(tenantId, filtros, { skip, take }) {
  const where = filtroListagem(tenantId, filtros);
  const [items, total] = await Promise.all([
    prisma.contaReceber.findMany({ where, skip, take, orderBy: { dataVencimento: 'asc' } }),
    prisma.contaReceber.count({ where }),
  ]);
  return { items, total };
}

async function buscarPorId(tenantId, id) {
  return prisma.contaReceber.findFirst({ where: { id, tenantId } });
}

async function darBaixa(tenantId, id, dados) {
  return prisma.contaReceber.update({ where: { id, tenantId }, data: dados });
}

async function cancelar(tenantId, id, observacao) {
  return prisma.contaReceber.update({ where: { id, tenantId }, data: { status: 'cancelado', observacao } });
}

module.exports = { criar, listar, buscarPorId, darBaixa, cancelar };
