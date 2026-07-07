/**
 * Arquivo: perfil.controller.js
 * Responsabilidade: Receber req/res das rotas de perfil e delegar ao
 * PerfilService. Nunca acessa o Prisma.
 * Utilizado por: perfil.routes.js.
 */
const service = require('../services/perfil.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const listar = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.listar(req.tenantId, { ...pag, take: pag.limit }));
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

module.exports = { listar, detalhar, criar, atualizar, remover };
