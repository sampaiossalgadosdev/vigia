/**
 * Arquivo: dashboard.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para as agregações do
 * dashboard. Vendas ficam em UTC no banco; todo agrupamento por dia/hora/
 * dia-da-semana converte pro fuso da loja (America/Sao_Paulo) no SQL.
 * Utilizado por: DashboardService.
 * Não contém regra de negócio (períodos e médias são calculados no service).
 */
const prisma = require('../config/database');

const TZ = 'America/Sao_Paulo';

async function resumoVendas(tenantId, inicio, fim) {
  const r = await prisma.venda.aggregate({
    where: { tenantId, status: 'concluida', dataVenda: { gte: inicio, lte: fim } },
    _sum: { total: true },
    _count: { _all: true },
  });
  return { total: Number(r._sum.total || 0), vendas: r._count._all };
}

async function vendasPorGrupo(tenantId, inicio, fim) {
  return prisma.$queryRaw`
    SELECT COALESCE(c.nome, 'Sem grupo') AS grupo,
           SUM(vi.quantidade * vi."precoUnitario")::float AS valor
    FROM "VendaItem" vi
    JOIN "Venda" v ON v.id = vi."vendaId"
    JOIN "Produto" p ON p.id = vi."produtoId"
    LEFT JOIN "Categoria" c ON c.id = p."categoriaId"
    WHERE v."tenantId" = ${tenantId} AND v.status = 'concluida'
      AND v."dataVenda" BETWEEN ${inicio} AND ${fim}
    GROUP BY 1
    ORDER BY 2 DESC`;
}

async function vendasPorFormaPagamento(tenantId, inicio, fim) {
  return prisma.$queryRaw`
    SELECT vp.forma, SUM(vp.valor)::float AS valor
    FROM "VendaPagamento" vp
    JOIN "Venda" v ON v.id = vp."vendaId"
    WHERE v."tenantId" = ${tenantId} AND v.status = 'concluida'
      AND v."dataVenda" BETWEEN ${inicio} AND ${fim}
    GROUP BY 1
    ORDER BY 2 DESC`;
}

async function topProdutos(tenantId, inicio, fim) {
  return prisma.$queryRaw`
    SELECT p.nome, p.unidade, SUM(vi.quantidade)::float AS quantidade
    FROM "VendaItem" vi
    JOIN "Venda" v ON v.id = vi."vendaId"
    JOIN "Produto" p ON p.id = vi."produtoId"
    WHERE v."tenantId" = ${tenantId} AND v.status = 'concluida'
      AND v."dataVenda" BETWEEN ${inicio} AND ${fim}
    GROUP BY p.id, p.nome, p.unidade
    ORDER BY 3 DESC
    LIMIT 10`;
}

async function topVendedores(tenantId, inicio, fim) {
  return prisma.$queryRaw`
    SELECT COALESCE(u.nome, 'Sem operador') AS nome, SUM(v.total)::float AS valor
    FROM "Venda" v
    LEFT JOIN "Usuario" u ON u.id = v."operadorId"
    WHERE v."tenantId" = ${tenantId} AND v.status = 'concluida'
      AND v."dataVenda" BETWEEN ${inicio} AND ${fim}
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 10`;
}

async function vendasPorDia(tenantId, inicio, fim) {
  return prisma.$queryRaw`
    SELECT EXTRACT(DAY FROM v."dataVenda" AT TIME ZONE ${TZ})::int AS dia,
           SUM(v.total)::float AS valor, COUNT(*)::int AS vendas
    FROM "Venda" v
    WHERE v."tenantId" = ${tenantId} AND v.status = 'concluida'
      AND v."dataVenda" BETWEEN ${inicio} AND ${fim}
    GROUP BY 1
    ORDER BY 1`;
}

async function vendasPorMes(tenantId, inicio, fim) {
  return prisma.$queryRaw`
    SELECT EXTRACT(MONTH FROM v."dataVenda" AT TIME ZONE ${TZ})::int AS mes,
           SUM(v.total)::float AS valor, COUNT(*)::int AS vendas
    FROM "Venda" v
    WHERE v."tenantId" = ${tenantId} AND v.status = 'concluida'
      AND v."dataVenda" BETWEEN ${inicio} AND ${fim}
    GROUP BY 1
    ORDER BY 1`;
}

/** EXTRACT(DOW): 0 = domingo … 6 = sábado (no fuso da loja). */
async function vendasPorDiaSemana(tenantId, inicio, fim) {
  return prisma.$queryRaw`
    SELECT EXTRACT(DOW FROM v."dataVenda" AT TIME ZONE ${TZ})::int AS dow,
           SUM(v.total)::float AS valor, COUNT(*)::int AS vendas
    FROM "Venda" v
    WHERE v."tenantId" = ${tenantId} AND v.status = 'concluida'
      AND v."dataVenda" BETWEEN ${inicio} AND ${fim}
    GROUP BY 1
    ORDER BY 1`;
}

async function vendasPorHora(tenantId, inicio, fim) {
  return prisma.$queryRaw`
    SELECT EXTRACT(HOUR FROM v."dataVenda" AT TIME ZONE ${TZ})::int AS hora,
           SUM(v.total)::float AS valor, COUNT(*)::int AS vendas
    FROM "Venda" v
    WHERE v."tenantId" = ${tenantId} AND v.status = 'concluida'
      AND v."dataVenda" BETWEEN ${inicio} AND ${fim}
    GROUP BY 1
    ORDER BY 1`;
}

module.exports = {
  resumoVendas, vendasPorGrupo, vendasPorFormaPagamento, topProdutos,
  topVendedores, vendasPorDia, vendasPorMes, vendasPorDiaSemana, vendasPorHora,
};
