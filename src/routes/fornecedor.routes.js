/**
 * Arquivo: fornecedor.routes.js
 * Responsabilidade: Definir os endpoints /api/fornecedores e encadear
 * middlewares e controller. Nenhuma lógica de negócio aqui.
 */
const { Router } = require('express');
const controller = require('../controllers/fornecedor.controller');
const validator = require('../validators/fornecedor.validator');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('fornecedores');

router.get('/', gestao, controller.listar);
router.post('/consultar-cnpj', gestao, validator.consultarCnpj, controller.consultarCnpj);
router.get('/:id', gestao, controller.detalhar);
router.get('/:id/compras', gestao, controller.compras);
router.get('/:id/produtos', gestao, controller.produtos);
router.post('/', gestao, validator.criar, controller.criar);
router.put('/:id', gestao, validator.atualizar, controller.atualizar);
router.delete('/:id', gestao, controller.remover);

module.exports = router;
