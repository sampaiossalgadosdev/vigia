const service = require('../services/caixa.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const atual = asyncHandler(async (req, res) => {
  success(res, await service.atual(req.tenantId));
});

const abrir = asyncHandler(async (req, res) => {
  success(res, await service.abrir(req.tenantId, req.body, req.usuario, req.ip), 201);
});

const fechar = asyncHandler(async (req, res) => {
  success(res, await service.fechar(req.tenantId, req.body, req.usuario, req.ip));
});

const sangria = asyncHandler(async (req, res) => {
  success(res, await service.sangria(req.tenantId, req.body, req.usuario, req.ip), 201);
});

const historico = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.historico(req.tenantId, req.query, { ...pag, limit: pag.limit }));
});

module.exports = { atual, abrir, fechar, sangria, historico };