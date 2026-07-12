/**
 * Arquivo: contaPagar.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para ContaPagar
 * (Fase 4a). Só operações mecânicas — regra de negócio fica em
 * contaPagar.service.js.
 * Utilizado por: ContaPagarService.
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
  return prisma.contaPagar.create({ data: dados, include: { fornecedor: { select: { id: true, nome: true, cnpj: true } } } });
}

async function listar(tenantId, filtros, { skip, take }) {
  const where = filtroListagem(tenantId, filtros);
  const [items, total] = await Promise.all([
    prisma.contaPagar.findMany({
      where, skip, take, orderBy: { dataVencimento: 'asc' },
      include: { fornecedor: { select: { id: true, nome: true, cnpj: true } } },
    }),
    prisma.contaPagar.count({ where }),
  ]);
  return { items, total };
}

async function buscarPorId(tenantId, id) {
  return prisma.contaPagar.findFirst({
    where: { id, tenantId },
    include: { fornecedor: { select: { id: true, nome: true, cnpj: true } } },
  });
}

async function darBaixa(tenantId, id, dados) {
  return prisma.contaPagar.update({ where: { id, tenantId }, data: dados });
}

async function cancelar(tenantId, id, observacao) {
  return prisma.contaPagar.update({ where: { id, tenantId }, data: { status: 'cancelado', observacao } });
}

module.exports = { criar, listar, buscarPorId, darBaixa, cancelar };
