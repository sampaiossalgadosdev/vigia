/**
 * Arquivo: categoria.routes.js
 * Responsabilidade: Definir os endpoints /api/categorias e encadear
 * middlewares (auth, permissao, validators) e controller. Categorias fazem
 * parte do módulo "produtos" pra fins de permissão. Nenhuma lógica aqui.
 */
const { Router } = require('express');
const controller = require('../controllers/categoria.controller');
const validator = require('../validators/categoria.validator');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('produtos');

router.get('/', gestao, controller.listar);
router.post('/', gestao, validator.criar, controller.criar);
router.put('/:id', gestao, validator.atualizar, controller.atualizar);
router.delete('/:id', gestao, controller.remover);
router.get('/:id/produtos', gestao, controller.listarProdutos);
router.post('/:id/aplicar-markup', gestao, controller.aplicarMarkup);

module.exports = router;
