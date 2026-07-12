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
  success(res, await service.confirmarNfe(req.tenantId, req.params.nfeId, req.usuario, req.ip, req.body.lotesPorItem || {}));
});

const listarNfes = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.listarNfes(req.tenantId, { status: req.query.status }, { ...pag, take: pag.limit }));
});

const detalharNfe = asyncHandler(async (req, res) => {
  success(res, await service.detalharNfe(req.tenantId, req.params.id));
});

const vincularItem = asyncHandler(async (req, res) => {
  const loteInfo = req.body.numeroLote || req.body.dataValidade
    ? { numeroLote: req.body.numeroLote, dataValidade: req.body.dataValidade }
    : undefined;
  success(res, await service.vincularItem(req.tenantId, req.params.nfeId, req.params.itemId, req.body.produtoId, req.usuario, req.ip, loteInfo));
});

const movimentacoes = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  const { produtoId, tipo, inicio, fim } = req.query;
  success(res, await service.listarMovimentacoes(req.tenantId, { produtoId, tipo, inicio, fim }, { ...pag, take: pag.limit }));
});

const pendentes = asyncHandler(async (req, res) => {
  success(res, await service.listarPendentes(req.tenantId));
});

const alertasValidade = asyncHandler(async (req, res) => {
  success(res, await service.alertasValidade(req.tenantId, req.query.dias));
});

const gerarPromocoesRelampago = asyncHandler(async (req, res) => {
  success(res, await service.gerarPromocoesRelampago(req.tenantId, req.usuario, req.ip, req.body.dias));
});

const ajustar = asyncHandler(async (req, res) => {
  const { produtoId, depositoId, novaQuantidade, motivo, loteId } = req.body;
  success(res, await service.ajustarEstoque(req.tenantId, req.usuario.id, produtoId, depositoId, novaQuantidade, motivo, loteId), 201);
});

const transferir = asyncHandler(async (req, res) => {
  const { produtoId, depositoOrigemId, depositoDestinoId, quantidade, motivo, loteId } = req.body;
  success(res, await service.transferirEstoque(req.tenantId, req.usuario.id, produtoId, depositoOrigemId, depositoDestinoId, quantidade, motivo, loteId), 201);
});

const transformar = asyncHandler(async (req, res) => {
  const { produtoOrigemId, produtoDestinoId, depositoId, quantidadeOrigemConsumida, quantidadeDestinoGerada, motivo, loteOrigemId, dataValidadeDestino } = req.body;
  success(res, await service.transformarProduto(req.tenantId, req.usuario.id, produtoOrigemId, produtoDestinoId, depositoId, quantidadeOrigemConsumida, quantidadeDestinoGerada, motivo, loteOrigemId, dataValidadeDestino), 201);
});

module.exports = {
  uploadNfe, confirmarNfe, listarNfes, detalharNfe, vincularItem, movimentacoes, pendentes,
  alertasValidade, gerarPromocoesRelampago, ajustar, transferir, transformar,
};
