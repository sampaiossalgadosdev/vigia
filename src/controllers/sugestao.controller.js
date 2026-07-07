/**
 * Arquivo: sugestao.controller.js
 * Responsabilidade: Receber req/res das rotas de sugestões recebidas pelo
 * tenant e delegar ao SugestaoService. Nunca acessa o Prisma.
 * Utilizado por: sugestao.routes.js.
 */
const service = require('../services/sugestao.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const listar = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.listar(req.tenantId, { ...pag, take: pag.limit }));
});

const marcarLida = asyncHandler(async (req, res) => {
  success(res, await service.mudarStatus(req.tenantId, req.params.id, 'lida'));
});

const marcarArquivada = asyncHandler(async (req, res) => {
  success(res, await service.mudarStatus(req.tenantId, req.params.id, 'arquivada'));
});

module.exports = { listar, marcarLida, marcarArquivada };
