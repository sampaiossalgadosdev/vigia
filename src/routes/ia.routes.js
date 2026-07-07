const { Router } = require('express');
const controller = require('../controllers/ia.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);
const gestao = exigePermissao('ia');

router.post('/sugestoes', gestao, controller.gerarSugestoes);
router.get('/sugestoes/historico', gestao, controller.historico);

module.exports = router;