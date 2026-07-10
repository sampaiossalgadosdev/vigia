const service = require('../services/acougueTv.service');
const { success, asyncHandler } = require('../utils/response');

const painel = asyncHandler(async (req, res) => {
  success(res, await service.painel(req.tenantId));
});

const tv = asyncHandler(async (req, res) => {
  success(res, await service.telaTv(req.query.token));
});

const link = asyncHandler(async (req, res) => {
  success(res, await service.obterLink(req.tenantId));
});

const gerarLink = asyncHandler(async (req, res) => {
  success(res, await service.gerarLink(req.tenantId, req.usuario, req.ip), 201);
});

module.exports = { painel, tv, link, gerarLink };
