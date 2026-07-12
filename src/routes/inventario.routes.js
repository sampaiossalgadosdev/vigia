/**
 * Arquivo: inventario.routes.js
 * Responsabilidade: Definir os endpoints /api/inventario e encadear
 * middlewares (auth, permissao do módulo "estoque" — mesmo padrão de
 * Depósito na Fase 2a) e controller. Nenhuma lógica aqui.
 */
const { Router } = require('express');
const controller = require('../controllers/inventario.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('estoque');

router.post('/iniciar', gestao, controller.iniciar);
router.get('/:id', gestao, controller.detalhar);
router.post('/:id/contagem', gestao, controller.contagem);
router.post('/:id/fechar', gestao, controller.fechar);

module.exports = router;
