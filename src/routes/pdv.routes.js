/**
 * Arquivo: pdv.routes.js
 * Responsabilidade: Rotas específicas do PDV desktop (Fase 3a). Usa a mesma
 * auth de tenant do resto do sistema — não existe uma "sessão de terminal"
 * separada; o token é o do operador que fez login no PDV.
 * Utilizado por: server.js.
 */
const { Router } = require('express');
const { auth } = require('../middlewares/auth');
const { success, asyncHandler } = require('../utils/response');
const pdvSnapshotService = require('../services/pdvSnapshot.service');

const router = Router();
router.use(auth);

router.get('/snapshot', asyncHandler(async (req, res) => {
  success(res, await pdvSnapshotService.montar(req.tenantId));
}));

module.exports = router;
