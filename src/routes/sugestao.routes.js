/**
 * Arquivo: sugestao.routes.js
 * Responsabilidade: Definir os endpoints /api/sugestoes (recebidas pelo tenant).
 */
const { Router } = require('express');
const controller = require('../controllers/sugestao.controller');
const { auth } = require('../middlewares/auth');

const router = Router();
router.use(auth);

router.get('/', controller.listar);
router.put('/:id/lida', controller.marcarLida);
router.put('/:id/arquivada', controller.marcarArquivada);

module.exports = router;
