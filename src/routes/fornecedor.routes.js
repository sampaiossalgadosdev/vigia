/**
 * Arquivo: fornecedor.routes.js
 * Responsabilidade: Definir os endpoints /api/fornecedores e encadear
 * middlewares e controller. Nenhuma lógica de negócio aqui.
 */
const { Router } = require('express');
const controller = require('../controllers/fornecedor.controller');
const validator = require('../validators/fornecedor.validator');
const { auth } = require('../middlewares/auth');
const { role } = require('../middlewares/role');

const router = Router();
router.use(auth);

const gestao = role(['dono', 'gerente']);

router.get('/', controller.listar);
router.get('/:id', controller.detalhar);
router.post('/', gestao, validator.criar, controller.criar);
router.put('/:id', gestao, validator.atualizar, controller.atualizar);
router.delete('/:id', gestao, controller.remover);

module.exports = router;
