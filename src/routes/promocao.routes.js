const { Router } = require('express');
const controller = require('../controllers/promocao.controller');
const { auth } = require('../middlewares/auth');
const { role } = require('../middlewares/role');

const router = Router();
router.use(auth);
const gestao = role(['dono', 'gerente']);

router.get('/', controller.listar);
router.get('/vigentes', controller.vigentes);
router.get('/:id', controller.detalhar);
router.post('/', gestao, controller.criar);
router.put('/:id', gestao, controller.atualizar);
router.delete('/:id', gestao, controller.remover);

module.exports = router;