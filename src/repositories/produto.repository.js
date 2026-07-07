/**
 * Arquivo: produto.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para a entidade Produto.
 * Utilizado por: ProdutoService, EstoqueService, ImportacaoService.
 * Não contém regra de negócio.
 */
const prisma = require('../config/database');

function filtroListagem(tenantId, { search, categoriaId, ativo }) {
  const where = { tenantId };
  where.ativo = ativo === 'false' ? false : ativo === 'todos' ? undefined : true;
  if (where.ativo === undefined) delete where.ativo;
  if (categoriaId) where.categoriaId = categoriaId;
  if (search)
    where.OR = [
      { nome: { contains: search, mode: 'insensitive' } },
      { ean: { contains: search } },
      { marca: { contains: search, mode: 'insensitive' } },
      { plu: { contains: search } },
    ];
  return where;
}

async function listar(tenantId, filtros, { skip, take, order }) {
  const where = filtroListagem(tenantId, filtros);
  const [items, total] = await Promise.all([
    prisma.produto.findMany({ where, skip, take, orderBy: { nome: order }, include: { categoria: { select: { id: true, nome: true } } } }),
    prisma.produto.count({ where }),
  ]);
  return { items, total };
}

async function buscarPorId(tenantId, id) {
  return prisma.produto.findFirst({ where: { id, tenantId }, include: { categoria: true } });
}

async function buscarPorEan(tenantId, ean) {
  return prisma.produto.findFirst({ where: { tenantId, ean } });
}

async function buscarPorEans(tenantId, eans) {
  return prisma.produto.findMany({ where: { tenantId, ean: { in: eans } } });
}

async function criar(dados) {
  return prisma.produto.create({ data: dados });
}

async function atualizar(id, dados) {
  return prisma.produto.update({ where: { id }, data: dados });
}

async function criarVarios(tx, dados) {
  return tx.produto.createMany({ data: dados, skipDuplicates: true });
}

/**
 * Sync incremental para o PDV: produtos alterados desde a data informada.
 */
async function sync(tenantId, desde) {
  const where = { tenantId };
  if (desde) where.updatedAt = { gt: desde };
  return prisma.produto.findMany({ where, orderBy: { updatedAt: 'asc' } });
}

/**
 * Produtos abaixo do mínimo ou com estoque negativo (comparação entre colunas via SQL).
 */
async function alertasEstoque(tenantId) {
  return prisma.$queryRaw`
    SELECT id, ean, nome, unidade, "estoqueQtd", "estoqueMin"
    FROM "Produto"
    WHERE "tenantId" = ${tenantId} AND ativo = true
      AND ("estoqueQtd" < 0 OR "estoqueQtd" <= "estoqueMin")
    ORDER BY "estoqueQtd" ASC
    LIMIT 200`;
}

async function contar(tenantId) {
  return prisma.produto.count({ where: { tenantId, ativo: true } });
}

async function buscarCategoria(tenantId, categoriaId) {
  return prisma.categoria.findFirst({ where: { id: categoriaId, tenantId, ativo: true } });
}

async function buscarOuCriarCategoria(tx, tenantId, nome) {
  const existente = await tx.categoria.findFirst({ where: { tenantId, nome } });
  if (existente) return existente;
  return tx.categoria.create({ data: { tenantId, nome } });
}

module.exports = {
  listar, buscarPorId, buscarPorEan, buscarPorEans, criar, atualizar,
  criarVarios, sync, alertasEstoque, contar, buscarCategoria, buscarOuCriarCategoria,
};
