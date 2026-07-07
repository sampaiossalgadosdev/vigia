const { Router } = require('express');
const controller = require('../controllers/ia.controller');
const { auth } = require('../middlewares/auth');

const router = Router();
router.use(auth);

router.post('/sugestoes', controller.gerarSugestoes);
router.get('/sugestoes/historico', controller.historico);

module.exports = router;