/**
 * Arquivo: dashboard.routes.js
 * Responsabilidade: Definir os endpoints /api/dashboard e encadear
 * middlewares (auth, permissao do módulo dashboard). Nenhuma lógica aqui.
 */
const { Router } = require('express');
const controller = require('../controllers/dashboard.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);

const gestao = exigePermissao('dashboard');

router.get('/resumo', gestao, controller.resumo);
router.get('/grupos-produtos', gestao, controller.gruposProdutos);
router.get('/formas-pagamento', gestao, controller.formasPagamento);
router.get('/top-produtos', gestao, controller.topProdutos);
router.get('/top-vendedores', gestao, controller.topVendedores);
router.get('/vendas-diarias', gestao, controller.vendasDiarias);
router.get('/vendas-mensais', gestao, controller.vendasMensais);
router.get('/venda-media-semanal', gestao, controller.vendaMediaSemanal);
router.get('/vendas-por-hora', gestao, controller.vendasPorHora);

module.exports = router;
