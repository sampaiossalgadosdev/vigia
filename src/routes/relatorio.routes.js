const { Router } = require('express');
const controller = require('../controllers/relatorio.controller');
const { auth } = require('../middlewares/auth');

const router = Router();
router.use(auth);

router.get('/vendas-dia', controller.vendasDia);
router.get('/vendas-periodo', controller.vendasPeriodo);
router.get('/produtos-mais-vendidos', controller.produtosMaisVendidos);
router.get('/margem', controller.margem);
router.get('/giro', controller.giro);
router.get('/estoque-critico', controller.estoqueCritico);
router.get('/dre-simplificado', controller.dreSimplificado);

module.exports = router;