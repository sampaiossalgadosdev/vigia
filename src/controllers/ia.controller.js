const service = require('../services/ia.service');
const { success, asyncHandler } = require('../utils/response');

const gerarSugestoes = asyncHandler(async (req, res) => {
  success(res, await service.gerarSugestoes(req.tenantId, req.usuario, req.ip), 201);
});

const historico = asyncHandler(async (req, res) => {
  success(res, await service.historico(req.tenantId));
});

module.exports = { gerarSugestoes, historico };