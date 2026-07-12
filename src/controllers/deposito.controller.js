/**
 * Arquivo: deposito.controller.js
 * Responsabilidade: Receber req/res das rotas de depósito e delegar ao
 * DepositoService. Nunca acessa o Prisma.
 * Utilizado por: deposito.routes.js.
 */
const service = require('../services/deposito.service');
const { success, asyncHandler } = require('../utils/response');

const listar = asyncHandler(async (req, res) => {
  success(res, await service.listar(req.tenantId));
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

module.exports = { listar, criar, atualizar, remover };
