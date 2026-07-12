/**
 * Arquivo: inventario.controller.js
 * Responsabilidade: Receber req/res das rotas de inventário e delegar ao
 * InventarioService. Nunca acessa o Prisma.
 * Utilizado por: inventario.routes.js.
 */
const service = require('../services/inventario.service');
const { success, asyncHandler } = require('../utils/response');

const iniciar = asyncHandler(async (req, res) => {
  const { depositoId, tipo, categoriaFiltro } = req.body;
  success(res, await service.iniciarInventario(req.tenantId, req.usuario.id, depositoId, tipo, categoriaFiltro), 201);
});

const detalhar = asyncHandler(async (req, res) => {
  success(res, await service.detalhar(req.tenantId, req.params.id));
});

const contagem = asyncHandler(async (req, res) => {
  const { produtoId, quantidadeContada } = req.body;
  success(res, await service.registrarContagem(req.tenantId, req.params.id, produtoId, quantidadeContada, req.usuario.id));
});

const fechar = asyncHandler(async (req, res) => {
  success(res, await service.fecharInventario(req.tenantId, req.params.id, req.usuario, req.ip));
});

module.exports = { iniciar, detalhar, contagem, fechar };
