/**
 * Arquivo: filaEmissao.controller.js
 * Responsabilidade: Receber req/res dos endpoints administrativos da fila
 * de emissão de NFC-e e delegar ao FilaEmissaoNfceService. Nunca acessa o
 * Prisma. Protegido por authAdmin (superadmin) em superadmin.routes.js —
 * a fila é global entre tenants (processarFilaEmissao não filtra por
 * tenant), então não faz sentido escopar isso ao Dono de um único tenant.
 * Utilizado por: superadmin.routes.js.
 */
const service = require('../services/filaEmissaoNfce.service');
const { success, asyncHandler } = require('../utils/response');

const processarAgora = asyncHandler(async (req, res) => {
  success(res, await service.processarFilaEmissao());
});

const status = asyncHandler(async (req, res) => {
  success(res, await service.statusFila());
});

module.exports = { processarAgora, status };
