/**
 * Arquivo: rede.controller.js
 * Responsabilidade: Receber req/res das rotas do painel de rede e delegar ao
 * RedeService. Nunca acessa o Prisma.
 * Utilizado por: rede.routes.js.
 */
const service = require('../services/rede.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const login = asyncHandler(async (req, res) => {
  success(res, await service.login(req.body.email, req.body.senha));
});

const lojas = asyncHandler(async (req, res) => {
  success(res, await service.lojas(req.superusuario));
});

const loja = asyncHandler(async (req, res) => {
  success(res, await service.loja(req.superusuario, req.params.tenantId));
});

const comparativo = asyncHandler(async (req, res) => {
  success(res, await service.comparativo(req.superusuario, req.query.mes));
});

const enviarSugestao = asyncHandler(async (req, res) => {
  success(res, await service.enviarSugestao(req.superusuario, req.body), 201);
});

const listarSugestoes = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.listarSugestoes(req.superusuario, { ...pag, take: pag.limit }));
});

module.exports = { login, lojas, loja, comparativo, enviarSugestao, listarSugestoes };
