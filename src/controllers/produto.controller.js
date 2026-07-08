/**
 * Arquivo: produto.controller.js
 * Responsabilidade: Receber req/res das rotas de produto e delegar ao
 * ProdutoService e ImportacaoService. Nunca acessa o Prisma.
 * Utilizado por: produto.routes.js.
 */
const service = require('../services/produto.service');
const importacao = require('../services/importacao.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const listar = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  const data = await service.listar(req.tenantId, { ...req.query, search: pag.search }, { ...pag, take: pag.limit });
  success(res, data);
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

const baixarModelo = asyncHandler(async (req, res) => {
  const buffer = importacao.modelo();
  res.setHeader('Content-Disposition', 'attachment; filename="modelo.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

const importarPreview = asyncHandler(async (req, res) => {
  success(res, await importacao.preview(req.tenantId, req.file));
});

const importarConfirmar = asyncHandler(async (req, res) => {
  success(res, await importacao.confirmar(req.tenantId, req.body.tokenImportacao, req.usuario, req.ip));
});

const sync = asyncHandler(async (req, res) => {
  success(res, await service.sync(req.tenantId, req.query.desde));
});

const alertas = asyncHandler(async (req, res) => {
  success(res, await service.alertas(req.tenantId));
});

const ultimaCompra = asyncHandler(async (req, res) => {
  success(res, await service.ultimaCompra(req.tenantId, req.params.id));
});

const listarCategorias = asyncHandler(async (req, res) => {
  success(res, await service.listarCategorias(req.tenantId));
});

module.exports = {
  listar, detalhar, criar, atualizar, remover,
  baixarModelo, importarPreview, importarConfirmar, sync, alertas,
  ultimaCompra, listarCategorias,
};
