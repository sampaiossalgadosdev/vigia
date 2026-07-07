const { Router } = require('express');
const controller = require('../controllers/relatorio.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');

const router = Router();
router.use(auth);
const gestao = exigePermissao('relatorios');

router.get('/vendas-dia', gestao, controller.vendasDia);
router.get('/vendas-periodo', gestao, controller.vendasPeriodo);
router.get('/produtos-mais-vendidos', gestao, controller.produtosMaisVendidos);
router.get('/margem', gestao, controller.margem);
router.get('/giro', gestao, controller.giro);
router.get('/estoque-critico', gestao, controller.estoqueCritico);
router.get('/dre-simplificado', gestao, controller.dreSimplificado);

module.exports = router;