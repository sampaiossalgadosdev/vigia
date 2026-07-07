const relatorioRepo = require('../repositories/relatorio.repository');

function inicioFim(query) {
  const fim = query.fim ? new Date(query.fim) : new Date();
  const inicio = query.inicio ? new Date(query.inicio) : new Date(fim); inicio.setHours(0,0,0,0);
  return { inicio, fim };
}

async function vendasDia(tenantId, query) {
  const { inicio, fim } = inicioFim(query);
  const vendas = await relatorioRepo.vendasDia(tenantId, inicio, fim);
  const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, total: 0, qtd: 0 }));
  vendas.forEach((venda) => {
    const h = new Date(venda.criadoEm).getHours();
    porHora[h].total += Number(venda.total);
    porHora[h].qtd += 1;
  });
  return { total: vendas.length, receita: vendas.reduce((sum, venda) => sum + Number(venda.total), 0), porHora };
}

async function vendasPeriodo(tenantId, query) {
  const { inicio, fim } = inicioFim(query);
  const vendas = await relatorioRepo.vendasDia(tenantId, inicio, fim);
  return { inicio, fim, total: vendas.length, receita: vendas.reduce((sum, venda) => sum + Number(venda.total), 0), vendas };
}

async function produtosMaisVendidos(tenantId, query) {
  const { inicio, fim } = inicioFim(query);
  return relatorioRepo.produtosMaisVendidos(tenantId, inicio, fim);
}

async function margem(tenantId, query) {
  const { inicio, fim } = inicioFim(query);
  return relatorioRepo.margem(tenantId, inicio, fim);
}

async function giro(tenantId) {
  return relatorioRepo.giro(tenantId);
}

async function estoqueCritico(tenantId) {
  return relatorioRepo.estoqueCritico(tenantId);
}

async function dreSimplificado(tenantId, query) {
  const mes = query.mes ? new Date(`${query.mes}-01`) : new Date();
  const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const fim = new Date(mes.getFullYear(), mes.getMonth() + 1, 0, 23, 59, 59, 999);
  const vendas = await relatorioRepo.vendasDia(tenantId, inicio, fim);
  const receita = vendas.reduce((sum, venda) => sum + Number(venda.total), 0);
  const custo = vendas.reduce((sum, venda) => sum + venda.itens.reduce((s, item) => s + Number(item.custoUnitario) * Number(item.quantidade), 0), 0);
  return { mes: query.mes || `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}`, receita, custo, margem: receita - custo, lucroBruto: receita - custo };
}

module.exports = { vendasDia, vendasPeriodo, produtosMaisVendidos, margem, giro, estoqueCritico, dreSimplificado };