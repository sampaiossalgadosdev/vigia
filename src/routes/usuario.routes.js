/**
 * Arquivo: usuario.routes.js
 * Responsabilidade: Definir os endpoints /api/usuarios com controle de perfil
 * (listar: dono/gerente; criar/editar/excluir: só dono).
 */
const { Router } = require('express');
const controller = require('../controllers/usuario.controller');
const validator = require('../validators/usuario.validator');
const { auth } = require('../middlewares/auth');
const { role } = require('../middlewares/role');

const router = Router();
router.use(auth);

router.get('/', role(['dono', 'gerente']), controller.listar);
router.post('/', role(['dono']), validator.criar, controller.criar);
router.put('/:id', role(['dono']), validator.atualizar, controller.atualizar);
router.delete('/:id', role(['dono']), controller.remover);

module.exports = router;
