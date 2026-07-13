const { Router } = require('express');
const controller = require('../controllers/caixa.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);
const gestao = exigePermissao('caixa');

router.get('/atual', gestao, controller.atual);
router.post('/abrir', gestao, controller.abrir);
router.post('/fechar', gestao, controller.fechar);
router.post('/sangria', gestao, controller.sangria);
router.get('/historico', gestao, controller.historico);

module.exports = router;