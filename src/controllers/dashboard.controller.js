/**
 * Arquivo: dashboard.controller.js
 * Responsabilidade: Receber req/res das rotas do dashboard e delegar ao
 * DashboardService. Nunca acessa o Prisma.
 * Utilizado por: dashboard.routes.js.
 */
const service = require('../services/dashboard.service');
const { success, asyncHandler } = require('../utils/response');

const handler = (fn) => asyncHandler(async (req, res) => {
  success(res, await fn(req.tenantId, req.query.data));
});

module.exports = {
  resumo: handler(service.resumo),
  gruposProdutos: handler(service.gruposProdutos),
  formasPagamento: handler(service.formasPagamento),
  topProdutos: handler(service.topProdutos),
  topVendedores: handler(service.topVendedores),
  vendasDiarias: handler(service.vendasDiarias),
  vendasMensais: handler(service.vendasMensais),
  vendaMediaSemanal: handler(service.vendaMediaSemanal),
  vendasPorHora: handler(service.vendasPorHora),
};
