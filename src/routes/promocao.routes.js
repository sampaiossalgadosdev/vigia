const { Router } = require('express');
const controller = require('../controllers/promocao.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);
const gestao = exigePermissao('promocoes');

router.get('/', gestao, controller.listar);
router.get('/vigentes', gestao, controller.vigentes);
router.get('/:id', gestao, controller.detalhar);
router.post('/', gestao, controller.criar);
router.put('/:id', gestao, controller.atualizar);
router.delete('/:id', gestao, controller.remover);

module.exports = router;