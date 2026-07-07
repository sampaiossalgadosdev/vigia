const { Router } = require('express');
const controller = require('../controllers/caixa.controller');
const { auth } = require('../middlewares/auth');

const router = Router();
router.use(auth);

router.get('/atual', controller.atual);
router.post('/abrir', controller.abrir);
router.post('/fechar', controller.fechar);
router.post('/sangria', controller.sangria);
router.get('/historico', controller.historico);

module.exports = router;