/**
 * Arquivo: perfil.routes.js
 * Responsabilidade: Definir os endpoints /api/perfis, controlados pela
 * matriz de permissões do módulo "perfis" (o Dono sempre passa; os Perfis
 * padrão vêm com "perfis" bloqueado, então na prática só o Dono gerencia).
 */
const { Router } = require('express');
const controller = require('../controllers/perfil.controller');
const validator = require('../validators/perfil.validator');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('perfis');

router.get('/', gestao, controller.listar);
router.get('/:id', gestao, controller.detalhar);
router.post('/', gestao, validator.criar, controller.criar);
router.put('/:id', gestao, validator.atualizar, controller.atualizar);
router.delete('/:id', gestao, controller.remover);

module.exports = router;
