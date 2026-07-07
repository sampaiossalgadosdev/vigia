/**
 * Arquivo: rede.routes.js
 * Responsabilidade: Definir os endpoints /api/rede (painel do superusuário).
 */
const { Router } = require('express');
const controller = require('../controllers/rede.controller');
const validator = require('../validators/auth.validator');
const { authRede } = require('../middlewares/authRede');

const router = Router();

router.post('/login', validator.login, controller.login);

router.use(authRede);

router.get('/lojas', controller.lojas);
router.get('/lojas/:tenantId', controller.loja);
router.get('/comparativo', controller.comparativo);
router.post('/sugestoes', controller.enviarSugestao);
router.get('/sugestoes', controller.listarSugestoes);

module.exports = router;
