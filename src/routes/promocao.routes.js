const { Router } = require('express');
const controller = require('../controllers/promocao.controller');
const validator = require('../validators/promocao.validator');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);
const gestao = exigePermissao('promocoes');

router.get('/', gestao, controller.listar);
router.get('/vigentes', gestao, controller.vigentes);
router.get('/produtos/busca', gestao, controller.buscarProdutos);
router.get('/:id', gestao, controller.detalhar);
router.post('/', gestao, validator.criar, controller.criar);
router.put('/:id', gestao, validator.atualizar, controller.atualizar);
router.delete('/:id', gestao, controller.remover);

module.exports = router;