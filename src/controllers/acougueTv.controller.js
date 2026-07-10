const service = require('../services/acougueTv.service');
const { success, asyncHandler } = require('../utils/response');

const painel = asyncHandler(async (req, res) => {
  success(res, await service.painel(req.tenantId));
});

const tv = asyncHandler(async (req, res) => {
  success(res, await service.telaTv(req.query.token));
});

const token = asyncHandler(async (req, res) => {
  success(res, await service.obterToken(req.tenantId));
});

const gerarToken = asyncHandler(async (req, res) => {
  success(res, await service.gerarToken(req.tenantId, req.usuario, req.ip), 201);
});

module.exports = { painel, tv, token, gerarToken };
