/**
 * Arquivo: categoria.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para a entidade Categoria
 * (hierarquia grupo/subgrupo) e para a atualização de preços por markup.
 * Utilizado por: CategoriaService.
 * Não contém regra de negócio.
 */
const prisma = require('../config/database');

/**
 * Árvore completa do tenant: grupos raiz com os subgrupos ativos aninhados.
 */
async function listarArvore(tenantId) {
  return prisma.categoria.findMany({
    where: { tenantId, ativo: true, parentId: null },
    orderBy: { nome: 'asc' },
    include: {
      filhos: {
        where: { ativo: true },
        orderBy: { nome: 'asc' },
      },
    },
  });
}

async function buscarPorId(tenantId, id) {
  return prisma.categoria.findFirst({
    where: { id, tenantId },
    include: { parent: { select: { id: true, nome: true } } },
  });
}

async function buscarPorNome(tenantId, nome) {
  return prisma.categoria.findFirst({ where: { tenantId, nome } });
}

async function criar(dados) {
  return prisma.categoria.create({ data: dados });
}

async function atualizar(tenantId, id, dados) {
  return prisma.categoria.update({ where: { id, tenantId }, data: dados });
}

async function contarFilhosAtivos(tenantId, id) {
  return prisma.categoria.count({ where: { tenantId, parentId: id, ativo: true } });
}

async function contarProdutosAtivos(tenantId, id) {
  return prisma.produto.count({ where: { tenantId, categoriaId: id, ativo: true } });
}

async function idsSubgruposAtivos(tenantId, id) {
  const filhos = await prisma.categoria.findMany({
    where: { tenantId, parentId: id, ativo: true },
    select: { id: true },
  });
  return filhos.map((f) => f.id);
}

async function listarProdutos(tenantId, categoriaId, { skip, take }) {
  const where = { tenantId, categoriaId, ativo: true };
  const [items, total] = await Promise.all([
    prisma.produto.findMany({
      where, skip, take,
      orderBy: { nome: 'asc' },
      select: { id: true, codigoReferencia: true, nome: true },
    }),
    prisma.produto.count({ where }),
  ]);
  return { items, total };
}

async function produtosParaMarkup(tenantId, categoriaIds) {
  return prisma.produto.findMany({
    where: { tenantId, categoriaId: { in: categoriaIds }, ativo: true },
    select: { id: true, custoMedio: true },
  });
}

/**
 * Grava os novos preços calculados pelo markup numa única transação:
 * ou todos os produtos são reprecificados, ou nenhum.
 */
async function aplicarPrecos(atualizacoes) {
  return prisma.$transaction(
    atualizacoes.map(({ id, preco }) => prisma.produto.update({ where: { id }, data: { preco } }))
  );
}

module.exports = {
  listarArvore, buscarPorId, buscarPorNome, criar, atualizar,
  contarFilhosAtivos, contarProdutosAtivos, idsSubgruposAtivos,
  listarProdutos, produtosParaMarkup, aplicarPrecos,
};
