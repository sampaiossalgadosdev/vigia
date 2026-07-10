/**
 * Arquivo: fornecedor.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para a entidade Fornecedor
 * (incluindo representantes e as consultas de histórico sobre Nfe/NfeItem).
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
  return prisma.fornecedor.findFirst({
    where: { id, tenantId },
    include: { representantes: { orderBy: { criadoEm: 'asc' } } },
  });
}

async function buscarPorCnpj(tenantId, cnpj) {
  return prisma.fornecedor.findFirst({ where: { tenantId, cnpj } });
}

async function criar(dados) {
  return prisma.fornecedor.create({ data: dados, include: { representantes: true } });
}

async function atualizar(id, dados) {
  return prisma.fornecedor.update({ where: { id }, data: dados });
}

/** Troca a lista inteira de representantes do fornecedor (padrão replace-all da edição). */
async function substituirRepresentantes(fornecedorId, representantes) {
  return prisma.$transaction([
    prisma.fornecedorRepresentante.deleteMany({ where: { fornecedorId } }),
    prisma.fornecedorRepresentante.createMany({
      data: representantes.map((r) => ({
        fornecedorId, nome: r.nome,
        email: r.email || null, telefone: r.telefone || null, celular: r.celular || null,
      })),
    }),
  ]);
}

/** NF-e do fornecedor, mais recentes primeiro, com a contagem de itens. */
async function listarCompras(tenantId, fornecedorId, { skip, take }) {
  const where = { tenantId, fornecedorId };
  const [items, total] = await Promise.all([
    prisma.nfe.findMany({
      where, skip, take,
      orderBy: { dataEmissao: 'desc' },
      include: { _count: { select: { itens: true } } },
    }),
    prisma.nfe.count({ where }),
  ]);
  return { items, total };
}

/**
 * Itens de NF-e do fornecedor vinculados a produto, da compra mais recente
 * para a mais antiga — o service pega o primeiro de cada produto para montar
 * a aba Produtos (última compra).
 */
async function listarItensComprados(tenantId, fornecedorId) {
  return prisma.nfeItem.findMany({
    where: { produtoId: { not: null }, nfe: { tenantId, fornecedorId } },
    include: {
      produto: { select: { id: true, nome: true, codigoReferencia: true } },
      nfe: { select: { dataEmissao: true } },
    },
    orderBy: { nfe: { dataEmissao: 'desc' } },
  });
}

module.exports = {
  listar, buscarPorId, buscarPorCnpj, criar, atualizar,
  substituirRepresentantes, listarCompras, listarItensComprados,
};
