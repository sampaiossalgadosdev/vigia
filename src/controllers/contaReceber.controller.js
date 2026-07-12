/**
 * Arquivo: contaReceber.controller.js
 * Responsabilidade: Receber req/res das rotas de ContaReceber e delegar ao
 * ContaReceberService. Nunca acessa o Prisma.
 * Utilizado por: contaReceber.routes.js.
 */
const service = require('../services/contaReceber.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const criar = asyncHandler(async (req, res) => {
  success(res, await service.criar(req.tenantId, req.body, req.usuario, req.ip), 201);
});

const listar = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  const { status, vencidas, dias } = req.query;
  success(res, await service.listar(req.tenantId, { status, vencidas, dias }, { ...pag, take: pag.limit }));
});

const detalhar = asyncHandler(async (req, res) => {
  success(res, await service.detalhar(req.tenantId, req.params.id));
});

const darBaixa = asyncHandler(async (req, res) => {
  success(res, await service.darBaixa(req.tenantId, req.params.id, req.body, req.usuario, req.ip));
});

const cancelar = asyncHandler(async (req, res) => {
  success(res, await service.cancelar(req.tenantId, req.params.id, req.body.motivo, req.usuario, req.ip));
});

module.exports = { criar, listar, detalhar, darBaixa, cancelar };
