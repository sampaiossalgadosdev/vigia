/**
 * Arquivo: nfeEntrada.controller.js
 * Responsabilidade: Receber req/res das rotas de NF-e de entrada e delegar
 * ao NfeEntradaService. Nunca acessa o Prisma.
 * Utilizado por: nfe-entrada.routes.js.
 */
const service = require('../services/nfeEntrada.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const consultarSefaz = asyncHandler(async (req, res) => {
  success(res, await service.consultarSefaz(req.tenantId, req.body));
});

const importar = asyncHandler(async (req, res) => {
  success(res, await service.importar(req.tenantId, req.body.chavesNfe, req.usuario, req.ip));
});

const historico = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.historico(req.tenantId, req.query, { ...pag, take: pag.limit }));
});

const itens = asyncHandler(async (req, res) => {
  success(res, await service.itens(req.tenantId, req.params.nfeId));
});

const vincular = asyncHandler(async (req, res) => {
  success(res, await service.vincular(req.tenantId, req.params.nfeId, req.params.itemId, req.body, req.usuario, req.ip));
});

const buscarProdutos = asyncHandler(async (req, res) => {
  success(res, await service.buscarProdutos(req.tenantId, req.query.nome));
});

module.exports = { consultarSefaz, importar, historico, itens, vincular, buscarProdutos };
