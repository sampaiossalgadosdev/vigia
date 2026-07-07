/**
 * Arquivo: estoque.controller.js
 * Responsabilidade: Receber req/res das rotas de estoque/NF-e e delegar ao
 * EstoqueService. Nunca acessa o Prisma.
 * Utilizado por: estoque.routes.js.
 */
const service = require('../services/estoque.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const uploadNfe = asyncHandler(async (req, res) => {
  success(res, await service.uploadNfe(req.tenantId, req.file ? req.file.buffer : null, req.usuario, req.ip), 201);
});

const confirmarNfe = asyncHandler(async (req, res) => {
  success(res, await service.confirmarNfe(req.tenantId, req.params.nfeId, req.usuario, req.ip));
});

const listarNfes = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.listarNfes(req.tenantId, { status: req.query.status }, { ...pag, take: pag.limit }));
});

const detalharNfe = asyncHandler(async (req, res) => {
  success(res, await service.detalharNfe(req.tenantId, req.params.id));
});

const vincularItem = asyncHandler(async (req, res) => {
  success(res, await service.vincularItem(req.tenantId, req.params.nfeId, req.params.itemId, req.body.produtoId, req.usuario, req.ip));
});

const movimentacoes = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  const { produtoId, tipo, inicio, fim } = req.query;
  success(res, await service.listarMovimentacoes(req.tenantId, { produtoId, tipo, inicio, fim }, { ...pag, take: pag.limit }));
});

const pendentes = asyncHandler(async (req, res) => {
  success(res, await service.listarPendentes(req.tenantId));
});

module.exports = { uploadNfe, confirmarNfe, listarNfes, detalharNfe, vincularItem, movimentacoes, pendentes };
