const service = require('../services/venda.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const listar = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.listar(req.tenantId, req.query, { ...pag, limit: pag.limit }));
});

const detalhar = asyncHandler(async (req, res) => {
  success(res, await service.detalhar(req.tenantId, req.params.id));
});

const registrar = asyncHandler(async (req, res) => {
  success(res, await service.registrar(req.tenantId, req.body, req.usuario, req.ip), 201);
});

const cancelar = asyncHandler(async (req, res) => {
  success(res, await service.cancelar(req.tenantId, req.params.id, req.usuario, req.body.motivo, req.ip));
});

const sync = asyncHandler(async (req, res) => {
  success(res, await service.sync(req.tenantId, req.body.vendas || []));
});

module.exports = { listar, detalhar, registrar, cancelar, sync };