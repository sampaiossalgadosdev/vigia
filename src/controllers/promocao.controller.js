const service = require('../services/promocao.service');
const { success, asyncHandler } = require('../utils/response');

const listar = asyncHandler(async (req, res) => {
  success(res, await service.listar(req.tenantId, req.query));
});

const detalhar = asyncHandler(async (req, res) => {
  success(res, await service.detalhar(req.tenantId, req.params.id));
});

const criar = asyncHandler(async (req, res) => {
  success(res, await service.criar(req.tenantId, req.body, req.usuario, req.ip), 201);
});

const atualizar = asyncHandler(async (req, res) => {
  success(res, await service.atualizar(req.tenantId, req.params.id, req.body, req.usuario, req.ip));
});

const remover = asyncHandler(async (req, res) => {
  success(res, await service.remover(req.tenantId, req.params.id, req.usuario, req.ip));
});

const vigentes = asyncHandler(async (req, res) => {
  success(res, await service.vigentes(req.tenantId));
});

module.exports = { listar, detalhar, criar, atualizar, remover, vigentes };