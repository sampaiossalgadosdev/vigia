/**
 * Arquivo: produto.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para a entidade Produto.
 * Utilizado por: ProdutoService, EstoqueService, ImportacaoService.
 * Não contém regra de negócio.
 */
const prisma = require('../config/database');
const estoqueDepositoRepo = require('./estoqueDeposito.repository');

/**
 * Filtros por coluna da listagem de produtos (padrão ERP): todos opcionais
 * e combinados com AND. Texto usa contains/insensitive; número usa igualdade
 * exata (filtro por faixa fica para uma próxima etapa).
 */
function filtroListagem(tenantId, { search, categoriaId, ativo, situacao, nome, grupo, valor, custoMedio, estoqueTotal, unidade, codigoReferencia }) {
  const where = { tenantId };

  const situacaoEfetiva = situacao !== undefined ? situacao : ativo === 'false' ? 'inativo' : ativo === 'todos' ? 'todos' : undefined;
  where.ativo = situacaoEfetiva === 'inativo' ? false : situacaoEfetiva === 'todos' ? undefined : true;
  if (where.ativo === undefined) delete where.ativo;

  if (categoriaId) where.categoriaId = categoriaId;
  if (nome) where.nome = { contains: nome, mode: 'insensitive' };
  if (grupo) where.categoria = { nome: { contains: grupo, mode: 'insensitive' } };
  if (unidade) where.unidade = { contains: unidade, mode: 'insensitive' };
  if (codigoReferencia) where.codigoReferencia = { contains: codigoReferencia, mode: 'insensitive' };

  if (valor !== undefined && valor !== '' && !Number.isNaN(Number(valor))) where.preco = Number(valor);
  if (custoMedio !== undefined && custoMedio !== '' && !Number.isNaN(Number(custoMedio))) where.custoMedio = Number(custoMedio);
  if (estoqueTotal !== undefined && estoqueTotal !== '' && !Number.isNaN(Number(estoqueTotal))) where.estoqueQtd = Number(estoqueTotal);

  if (search)
    where.OR = [
      { nome: { contains: search, mode: 'insensitive' } },
      { ean: { contains: search } },
      { marca: { contains: search, mode: 'insensitive' } },
      { plu: { contains: search } },
      { codigoReferencia: { contains: search, mode: 'insensitive' } },
    ];
  return where;
}

/**
 * Traduz a coluna pedida em ?orderBy= para a cláusula orderBy do Prisma.
 * Colunas desconhecidas caem no padrão (nome).
 */
function montarOrderBy(orderBy, order) {
  const mapa = {
    nome: { nome: order },
    grupo: { categoria: { nome: order } },
    valor: { preco: order },
    custoMedio: { custoMedio: order },
    estoqueTotal: { estoqueQtd: order },
    unidade: { unidade: order },
    codigoReferencia: { codigoReferencia: order },
    situacao: { ativo: order },
  };
  return mapa[orderBy] || { nome: order };
}

async function listar(tenantId, filtros, { skip, take, order }) {
  const where = filtroListagem(tenantId, filtros);
  const orderByClause = montarOrderBy(filtros.orderBy, order);
  const [items, total] = await Promise.all([
    prisma.produto.findMany({ where, skip, take, orderBy: orderByClause, include: { categoria: { select: { id: true, nome: true } } } }),
    prisma.produto.count({ where }),
  ]);
  return { items, total };
}

/** `tx` opcional (default o client singleton) — achado de revisão 2026-07-20: venda.service.cancelar() precisa ler o produto de dentro da MESMA transação que reverte o estoque dele. Chamadores existentes continuam iguais, sem passar o 3º argumento. */
async function buscarPorId(tenantId, id, tx = prisma) {
  return tx.produto.findFirst({ where: { id, tenantId }, include: { categoria: true } });
}

async function buscarPorEan(tenantId, ean) {
  return prisma.produto.findFirst({ where: { tenantId, ean } });
}

async function buscarPorEans(tenantId, eans) {
  return prisma.produto.findMany({ where: { tenantId, ean: { in: eans } } });
}

async function buscarPorCodigoReferencia(tenantId, codigoReferencia) {
  return prisma.produto.findFirst({ where: { tenantId, codigoReferencia } });
}

async function criar(dados) {
  return prisma.produto.create({ data: dados });
}

/**
 * Cria o produto com Cód. Ref. sequencial por tenant: incrementa
 * Tenant.ultimoCodigoReferencia atomicamente e usa o novo valor na mesma
 * transação, evitando colisão entre criações concorrentes.
 */
async function criarComCodigoSequencial(tenantId, dados) {
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { ultimoCodigoReferencia: { increment: 1 } },
    });
    const produto = await tx.produto.create({
      data: { ...dados, tenantId, codigoReferencia: String(tenant.ultimoCodigoReferencia) },
    });
    // Fase 2a: toda criação de produto já nasce com sua linha de estoque no
    // Depósito Principal, espelhando o estoqueQtd inicial informado.
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(tx, tenantId);
    await tx.estoqueProduto.create({
      data: { produtoId: produto.id, depositoId: deposito.id, quantidade: produto.estoqueQtd },
    });
    return produto;
  });
}

async function atualizar(tenantId, id, dados) {
  return prisma.produto.update({ where: { id, tenantId }, data: dados });
}

async function listarPorIds(tenantId, ids) {
  return prisma.produto.findMany({
    where: { tenantId, id: { in: ids } },
    include: { categoria: { select: { id: true, nome: true } } },
  });
}

/**
 * Aplica o mesmo conjunto de campos a vários produtos numa única transação:
 * ou todos são atualizados, ou nenhum.
 */
async function atualizarEmLote(tenantId, ids, dados) {
  return prisma.$transaction(async (tx) => {
    const resultado = await tx.produto.updateMany({
      where: { tenantId, id: { in: ids } },
      data: dados,
    });
    return resultado.count;
  });
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

/**
 * Última compra do produto via NF-e confirmada: item mais recente pela data
 * de emissão da nota, com preço unitário pago e fornecedor.
 */
async function ultimaCompra(tenantId, produtoId) {
  return prisma.nfeItem.findFirst({
    where: { produtoId, nfe: { tenantId, status: 'confirmada' } },
    orderBy: { nfe: { dataEmissao: 'desc' } },
    select: {
      valorUnitario: true,
      quantidade: true,
      nfe: {
        select: {
          numeroNfe: true,
          dataEmissao: true,
          fornecedor: { select: { id: true, nome: true } },
        },
      },
    },
  });
}

async function listarCategorias(tenantId) {
  return prisma.categoria.findMany({
    where: { tenantId, ativo: true },
    orderBy: { nome: 'asc' },
    select: { id: true, nome: true },
  });
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
  listar, buscarPorId, buscarPorEan, buscarPorEans, buscarPorCodigoReferencia, criar,
  criarComCodigoSequencial, atualizar, listarPorIds, atualizarEmLote, criarVarios,
  sync, alertasEstoque, contar,
  buscarCategoria, buscarOuCriarCategoria, ultimaCompra, listarCategorias,
};
