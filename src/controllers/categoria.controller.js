/**
 * Arquivo: categoria.controller.js
 * Responsabilidade: Receber req/res das rotas de categoria e delegar ao
 * CategoriaService. Nunca acessa o Prisma.
 * Utilizado por: categoria.routes.js.
 */
const service = require('../services/categoria.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const listar = asyncHandler(async (req, res) => {
  success(res, await service.listarArvore(req.tenantId));
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

const listarProdutos = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.listarProdutos(req.tenantId, req.params.id, { ...pag, take: pag.limit }));
});

const aplicarMarkup = asyncHandler(async (req, res) => {
  success(res, await service.aplicarMarkup(req.tenantId, req.params.id, req.usuario, req.ip));
});

module.exports = { listar, criar, atualizar, remover, listarProdutos, aplicarMarkup };
