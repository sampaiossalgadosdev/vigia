const { Router } = require('express');
const controller = require('../controllers/acougueTv.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();

// Tela da TV: pública, autenticada pelo token digitado na televisão (?token=...)
router.get('/tv', controller.tv);

router.use(auth);
const gestao = exigePermissao('produtos');

router.get('/produtos', gestao, controller.painel);
router.get('/token', gestao, controller.token);
router.post('/token', gestao, controller.gerarToken);

module.exports = router;
