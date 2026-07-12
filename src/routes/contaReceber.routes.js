/**
 * Arquivo: contaReceber.routes.js
 * Responsabilidade: Definir os endpoints /api/contas-receber e encadear
 * middlewares (auth, permissao do módulo "financeiro" — Fase 4a) e
 * controller. Nenhuma lógica aqui.
 */
const { Router } = require('express');
const controller = require('../controllers/contaReceber.controller');
const validator = require('../validators/contaReceber.validator');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('financeiro');

router.get('/', gestao, controller.listar);
router.post('/', gestao, validator.criar, controller.criar);
router.get('/:id', gestao, controller.detalhar);
router.post('/:id/baixa', gestao, validator.baixa, controller.darBaixa);
router.post('/:id/cancelar', gestao, validator.cancelar, controller.cancelar);

module.exports = router;
