const prisma = require('../config/database');

async function vendasDia(tenantId, inicio, fim) {
  return prisma.venda.findMany({
    where: { tenantId, criadoEm: { gte: inicio, lte: fim }, status: 'concluida' },
    include: { pagamentos: true },
    orderBy: { criadoEm: 'asc' },
  });
}

async function produtosMaisVendidos(tenantId, inicio, fim) {
  const vendas = await prisma.venda.findMany({
    where: { tenantId, criadoEm: { gte: inicio, lte: fim }, status: 'concluida' },
    include: { itens: true },
  });
  const agregados = new Map();
  vendas.forEach((venda) => {
    venda.itens.forEach((item) => {
      const key = item.produtoId;
      const atual = agregados.get(key) || { produtoId: key, qtd: 0, receita: 0, custo: 0 };
      atual.qtd += Number(item.quantidade);
      atual.receita += Number(item.total);
      atual.custo += Number(item.custoUnitario) * Number(item.quantidade);
      agregados.set(key, atual);
    });
  });
  return Array.from(agregados.values()).sort((a, b) => b.qtd - a.qtd).slice(0, 20);
}

async function margem(tenantId, inicio, fim) {
  const vendas = await prisma.venda.findMany({
    where: { tenantId, criadoEm: { gte: inicio, lte: fim }, status: 'concluida' },
    include: { itens: true },
  });
  const agregados = new Map();
  vendas.forEach((venda) => {
    venda.itens.forEach((item) => {
      const key = item.produtoId;
      const atual = agregados.get(key) || { produtoId: key, receita: 0, custo: 0 };
      atual.receita += Number(item.total);
      atual.custo += Number(item.custoUnitario) * Number(item.quantidade);
      agregados.set(key, atual);
    });
  });
  return Array.from(agregados.values()).map((item) => ({ ...item, margem: item.receita - item.custo }));
}

async function giro(tenantId) {
  const vendas = await prisma.venda.findMany({ where: { tenantId, status: 'concluida' }, include: { itens: true } });
  const agregados = new Map();
  vendas.forEach((venda) => {
    venda.itens.forEach((item) => {
      const atual = agregados.get(item.produtoId) || { produtoId: item.produtoId, qtd: 0 };
      atual.qtd += Number(item.quantidade);
      agregados.set(item.produtoId, atual);
    });
  });
  return Array.from(agregados.values()).sort((a, b) => b.qtd - a.qtd).slice(0, 20);
}

async function estoqueCritico(tenantId) {
  return prisma.$queryRaw`
    SELECT id, ean, nome, unidade, "estoqueQtd", "estoqueMin"
    FROM "Produto"
    WHERE "tenantId" = ${tenantId} AND ativo = true
      AND ("estoqueQtd" < 0 OR "estoqueQtd" <= "estoqueMin")
    ORDER BY "estoqueQtd" ASC
    LIMIT 200
  `;
}

module.exports = { vendasDia, produtosMaisVendidos, margem, giro, estoqueCritico };