const { Router } = require('express');
const controller = require('../controllers/venda.controller');
const { auth } = require('../middlewares/auth');
const { role } = require('../middlewares/role');

const router = Router();
router.use(auth);
const gerenteOuDono = role(['dono', 'gerente']);

router.get('/', controller.listar);
router.get('/:id', controller.detalhar);
router.post('/', controller.registrar);
router.post('/:id/cancelar', gerenteOuDono, controller.cancelar);
router.post('/sync', controller.sync);

module.exports = router;