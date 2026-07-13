/**
 * Arquivo: rede.routes.js
 * Responsabilidade: Definir os endpoints /api/rede (painel do superusuário).
 */
const { Router } = require('express');
const controller = require('../controllers/rede.controller');
const validator = require('../validators/auth.validator');
const { auth } = require('../middlewares/auth');
const { authRede } = require('../middlewares/authRede');
const { loginLimiter } = require('../middlewares/rateLimiter');

const router = Router();

router.post('/login', loginLimiter, validator.login, controller.login);

// Ponte de SSO: autenticado como usuário do tenant (Dono, plano pro), não
// como Superusuário — por isso fica fora do router.use(authRede) abaixo.
router.post('/sso', auth, controller.sso);

router.use(authRede);

router.get('/lojas', controller.lojas);
router.get('/lojas/:tenantId', controller.loja);
router.get('/comparativo', controller.comparativo);
router.post('/sugestoes', controller.enviarSugestao);
router.get('/sugestoes', controller.listarSugestoes);

module.exports = router;
