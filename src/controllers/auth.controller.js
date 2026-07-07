/**
 * Arquivo: auth.controller.js
 * Responsabilidade: Receber req/res das rotas de autenticação do tenant e
 * delegar ao AuthService. Nunca acessa o Prisma.
 * Utilizado por: auth.routes.js.
 */
const service = require('../services/auth.service');
const { success, asyncHandler } = require('../utils/response');

const login = asyncHandler(async (req, res) => {
  const data = await service.login(req.body.email, req.body.senha, req.ip);
  success(res, data);
});

const refresh = asyncHandler(async (req, res) => {
  const data = await service.refresh(req.body.refreshToken);
  success(res, data);
});

const logout = asyncHandler(async (req, res) => {
  const data = await service.logout(req.body.refreshToken, req.usuario, req.ip);
  success(res, data);
});

const me = asyncHandler(async (req, res) => {
  success(res, { usuario: req.usuario });
});

module.exports = { login, refresh, logout, me };
