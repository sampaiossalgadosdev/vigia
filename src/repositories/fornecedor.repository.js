/**
 * Arquivo: fornecedor.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para a entidade Fornecedor.
 * Utilizado por: FornecedorService, EstoqueService.
 * Não contém regra de negócio.
 */
const prisma = require('../config/database');

async function listar(tenantId, { search }, { skip, take, order }) {
  const where = { tenantId, ativo: true };
  if (search)
    where.OR = [
      { nome: { contains: search, mode: 'insensitive' } },
      { cnpj: { contains: search.replace(/\D/g, '') || search } },
    ];
  const [items, total] = await Promise.all([
    prisma.fornecedor.findMany({ where, skip, take, orderBy: { nome: order } }),
    prisma.fornecedor.count({ where }),
  ]);
  return { items, total };
}

async function buscarPorId(tenantId, id) {
  return prisma.fornecedor.findFirst({ where: { id, tenantId } });
}

async function buscarPorCnpj(tenantId, cnpj) {
  return prisma.fornecedor.findFirst({ where: { tenantId, cnpj } });
}

async function criar(dados) {
  return prisma.fornecedor.create({ data: dados });
}

async function atualizar(id, dados) {
  return prisma.fornecedor.update({ where: { id }, data: dados });
}

module.exports = { listar, buscarPorId, buscarPorCnpj, criar, atualizar };
