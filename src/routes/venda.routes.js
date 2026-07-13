const { Router } = require('express');
const controller = require('../controllers/venda.controller');
const validator = require('../validators/venda.validator');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);
const gestao = exigePermissao('vendas');

// Registro/sync de vendas é operação de PDV: qualquer usuário autenticado do
// tenant pode vender, independente da matriz de permissões da retaguarda.
router.get('/', gestao, controller.listar);
router.get('/:id', gestao, controller.detalhar);
router.get('/:id/xml', gestao, controller.buscarXml);
router.post('/', validator.registrar, controller.registrar);
router.post('/:id/cancelar', gestao, controller.cancelar);
router.post('/sync', controller.sync);

module.exports = router;