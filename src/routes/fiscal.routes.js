/**
 * Arquivo: fiscal.routes.js
 * Responsabilidade: Definir os endpoints /api/fiscal e encadear
 * middlewares (auth, permissão do módulo "relatorios" — exportação de
 * XML é fundamentalmente um relatório/extração de dados, reaproveita o
 * módulo já existente em vez de criar um novo só pra isso) e controller.
 */
const { Router } = require('express');
const controller = require('../controllers/fiscal.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('relatorios');

router.get('/exportar-xmls', gestao, controller.exportarXmls);

module.exports = router;
