const { Router } = require('express');
const controller = require('../controllers/acougueTv.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();

// Tela da TV: pública, autenticada pelo token do link (?token=...)
router.get('/tv', controller.tv);

router.use(auth);
const gestao = exigePermissao('produtos');

router.get('/produtos', gestao, controller.painel);
router.get('/link', gestao, controller.link);
router.post('/link', gestao, controller.gerarLink);

module.exports = router;
