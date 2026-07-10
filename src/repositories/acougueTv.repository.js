/**
 * Arquivo: acougueTv.repository.js
 * Responsabilidade: Acesso a dados do Açougue TV — grupo de categorias
 * "Açougue" com seus subgrupos, produtos do escopo e o tvToken do tenant
 * (token do link público da tela da TV).
 * Utilizado por: acougueTv.service.
 */
const prisma = require('../config/database');

/** Grupo "Açougue" do tenant com os subgrupos ativos (hierarquia de 2 níveis). */
async function buscarGrupoAcougue(tenantId) {
  return prisma.categoria.findFirst({
    where: { tenantId, parentId: null, ativo: true, nome: { equals: 'Açougue', mode: 'insensitive' } },
    include: { filhos: { where: { ativo: true }, orderBy: { nome: 'asc' } } },
  });
}

async function listarProdutos(tenantId, categoriaIds) {
  return prisma.produto.findMany({
    where: { tenantId, ativo: true, categoriaId: { in: categoriaIds } },
    orderBy: { nome: 'asc' },
    include: { categoria: { select: { id: true, nome: true } } },
  });
}

async function buscarTenantPorTvToken(tvToken) {
  return prisma.tenant.findFirst({
    where: { tvToken, ativo: true },
    select: { id: true, nome: true },
  });
}

async function buscarTvToken(tenantId) {
  return prisma.tenant.findUnique({ where: { id: tenantId }, select: { tvToken: true } });
}

async function definirTvToken(tenantId, tvToken) {
  return prisma.tenant.update({ where: { id: tenantId }, data: { tvToken }, select: { tvToken: true } });
}

module.exports = { buscarGrupoAcougue, listarProdutos, buscarTenantPorTvToken, buscarTvToken, definirTvToken };
