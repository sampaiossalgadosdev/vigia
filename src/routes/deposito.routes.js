/**
 * Arquivo: deposito.routes.js
 * Responsabilidade: Definir os endpoints /api/depositos e encadear
 * middlewares (auth, permissao, validators) e controller. Depósito faz
 * parte do módulo "estoque" pra fins de permissão. Nenhuma lógica aqui.
 */
const { Router } = require('express');
const controller = require('../controllers/deposito.controller');
const validator = require('../validators/deposito.validator');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('estoque');

router.get('/', gestao, controller.listar);
router.post('/', gestao, validator.criar, controller.criar);
router.put('/:id', gestao, validator.atualizar, controller.atualizar);
router.delete('/:id', gestao, controller.remover);

module.exports = router;
