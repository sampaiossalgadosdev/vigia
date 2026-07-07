/**
 * Arquivo: usuario.routes.js
 * Responsabilidade: Definir os endpoints /api/usuarios, controlados pela
 * matriz de permissões do módulo "usuarios" (o Dono sempre passa).
 */
const { Router } = require('express');
const controller = require('../controllers/usuario.controller');
const validator = require('../validators/usuario.validator');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('usuarios');

router.get('/', gestao, controller.listar);
router.post('/', gestao, validator.criar, controller.criar);
router.put('/:id', gestao, validator.atualizar, controller.atualizar);
router.delete('/:id', gestao, controller.remover);

module.exports = router;
