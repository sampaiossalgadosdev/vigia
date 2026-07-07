const service = require('../services/relatorio.service');
const { success, asyncHandler } = require('../utils/response');

const vendasDia = asyncHandler(async (req, res) => { success(res, await service.vendasDia(req.tenantId, req.query)); });
const vendasPeriodo = asyncHandler(async (req, res) => { success(res, await service.vendasPeriodo(req.tenantId, req.query)); });
const produtosMaisVendidos = asyncHandler(async (req, res) => { success(res, await service.produtosMaisVendidos(req.tenantId, req.query)); });
const margem = asyncHandler(async (req, res) => { success(res, await service.margem(req.tenantId, req.query)); });
const giro = asyncHandler(async (req, res) => { success(res, await service.giro(req.tenantId)); });
const estoqueCritico = asyncHandler(async (req, res) => { success(res, await service.estoqueCritico(req.tenantId)); });
const dreSimplificado = asyncHandler(async (req, res) => { success(res, await service.dreSimplificado(req.tenantId, req.query)); });

module.exports = { vendasDia, vendasPeriodo, produtosMaisVendidos, margem, giro, estoqueCritico, dreSimplificado };