/**
 * Arquivo: sugestao.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para a entidade Sugestao.
 * Utilizado por: SugestaoService, RedeService.
 * Não contém regra de negócio.
 */
const prisma = require('../config/database');

async function listarPorTenant(tenantId, { skip, take }) {
  const where = { tenantId, status: { not: 'arquivada' } };
  const [items, total, pendentes] = await Promise.all([
    prisma.sugestao.findMany({
      where, skip, take, orderBy: { criadoEm: 'desc' },
      include: { superusuario: { select: { nome: true } } },
    }),
    prisma.sugestao.count({ where }),
    prisma.sugestao.count({ where: { tenantId, status: 'pendente' } }),
  ]);
  return { items, total, pendentes };
}

async function buscarPorId(id) {
  return prisma.sugestao.findUnique({ where: { id } });
}

async function atualizarStatus(id, status) {
  return prisma.sugestao.update({ where: { id }, data: { status } });
}

async function criar(dados) {
  return prisma.sugestao.create({ data: dados, include: { tenant: { select: { nome: true } } } });
}

async function listarPorSuperusuario(superusuarioId, { skip, take }) {
  const where = { superusuarioId };
  const [items, total] = await Promise.all([
    prisma.sugestao.findMany({
      where, skip, take, orderBy: { criadoEm: 'desc' },
      include: { tenant: { select: { id: true, nome: true } } },
    }),
    prisma.sugestao.count({ where }),
  ]);
  return { items, total };
}

module.exports = { listarPorTenant, buscarPorId, atualizarStatus, criar, listarPorSuperusuario };
