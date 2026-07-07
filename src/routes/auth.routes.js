/**
 * Arquivo: auth.routes.js
 * Responsabilidade: Definir os endpoints /api/auth e encadear validators,
 * middlewares e controller. Nenhuma lógica de negócio aqui.
 */
const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const validator = require('../validators/auth.validator');
const { auth } = require('../middlewares/auth');

const router = Router();

router.post('/login', validator.login, controller.login);
router.post('/refresh', validator.refresh, controller.refresh);
router.post('/logout', validator.refresh, controller.logout);
router.get('/me', auth, controller.me);

module.exports = router;
