/**
 * Arquivo: rede.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para as consultas de
 * métricas do painel de rede (agregações SQL sobre MovimentacaoEstoque e Produto).
 * Observação: na Parte 1 ainda não existem vendas de PDV; o "faturamento" é
 * derivado das movimentações de saída (quantidade × preço atual do produto).
 * Utilizado por: RedeService.
 */
const prisma = require('../config/database');

async function buscarTenantsResumo(tenantIds) {
  return prisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, nome: true, cnpj: true, ativo: true, plano: true },
    orderBy: { nome: 'asc' },
  });
}

/**
 * Faturamento estimado e nº de saídas de um tenant em um intervalo [inicio, fim).
 */
async function faturamentoPeriodo(tenantId, inicio, fim) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(m.quantidade * p.preco), 0) AS total, COUNT(*)::int AS movimentacoes
    FROM "MovimentacaoEstoque" m
    JOIN "Produto" p ON p.id = m."produtoId"
    WHERE m."tenantId" = ${tenantId} AND m.tipo = 'saida'
      AND m."criadoEm" >= ${inicio} AND m."criadoEm" < ${fim}`;
  return { total: Number(rows[0].total), movimentacoes: rows[0].movimentacoes };
}

/**
 * Série diária de saídas (valor estimado) em um intervalo.
 */
async function vendasPorDia(tenantId, inicio, fim) {
  const rows = await prisma.$queryRaw`
    SELECT to_char(m."criadoEm", 'YYYY-MM-DD') AS dia,
           COALESCE(SUM(m.quantidade * p.preco), 0) AS total
    FROM "MovimentacaoEstoque" m
    JOIN "Produto" p ON p.id = m."produtoId"
    WHERE m."tenantId" = ${tenantId} AND m.tipo = 'saida'
      AND m."criadoEm" >= ${inicio} AND m."criadoEm" < ${fim}
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ dia: r.dia, total: Number(r.total) }));
}

/**
 * Top N produtos por valor de saída em um intervalo.
 */
async function topProdutos(tenantId, inicio, fim, limite = 10) {
  const rows = await prisma.$queryRaw`
    SELECT p.id, p.nome, p.ean,
           COALESCE(SUM(m.quantidade), 0) AS quantidade,
           COALESCE(SUM(m.quantidade * p.preco), 0) AS total
    FROM "MovimentacaoEstoque" m
    JOIN "Produto" p ON p.id = m."produtoId"
    WHERE m."tenantId" = ${tenantId} AND m.tipo = 'saida'
      AND m."criadoEm" >= ${inicio} AND m."criadoEm" < ${fim}
    GROUP BY p.id, p.nome, p.ean
    ORDER BY total DESC
    LIMIT ${limite}`;
  return rows.map((r) => ({ ...r, quantidade: Number(r.quantidade), total: Number(r.total) }));
}

/**
 * Top N produtos consolidados em vários tenants (visão da rede).
 */
async function topProdutosRede(tenantIds, inicio, fim, limite = 10) {
  const rows = await prisma.$queryRaw`
    SELECT p.nome,
           COALESCE(SUM(m.quantidade), 0) AS quantidade,
           COALESCE(SUM(m.quantidade * p.preco), 0) AS total
    FROM "MovimentacaoEstoque" m
    JOIN "Produto" p ON p.id = m."produtoId"
    WHERE m."tenantId" = ANY(${tenantIds}) AND m.tipo = 'saida'
      AND m."criadoEm" >= ${inicio} AND m."criadoEm" < ${fim}
    GROUP BY p.nome
    ORDER BY total DESC
    LIMIT ${limite}`;
  return rows.map((r) => ({ nome: r.nome, quantidade: Number(r.quantidade), total: Number(r.total) }));
}

/**
 * Quantidade de produtos em ruptura (estoque <= 0) de um tenant.
 */
async function contarRupturas(tenantId) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total FROM "Produto"
    WHERE "tenantId" = ${tenantId} AND ativo = true AND "estoqueQtd" <= 0`;
  return rows[0].total;
}

async function listarRupturas(tenantId, limite = 20) {
  const rows = await prisma.$queryRaw`
    SELECT id, nome, ean, "estoqueQtd", "estoqueMin" FROM "Produto"
    WHERE "tenantId" = ${tenantId} AND ativo = true AND "estoqueQtd" <= 0
    ORDER BY nome ASC LIMIT ${limite}`;
  return rows;
}

/**
 * Faturamento estimado agrupado por mês (YYYY-MM) dos últimos N meses.
 */
async function historicoMensal(tenantId, inicio) {
  const rows = await prisma.$queryRaw`
    SELECT to_char(m."criadoEm", 'YYYY-MM') AS mes,
           COALESCE(SUM(m.quantidade * p.preco), 0) AS total
    FROM "MovimentacaoEstoque" m
    JOIN "Produto" p ON p.id = m."produtoId"
    WHERE m."tenantId" = ${tenantId} AND m.tipo = 'saida' AND m."criadoEm" >= ${inicio}
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ mes: r.mes, total: Number(r.total) }));
}

module.exports = {
  buscarTenantsResumo, faturamentoPeriodo, vendasPorDia, topProdutos,
  topProdutosRede, contarRupturas, listarRupturas, historicoMensal,
};
