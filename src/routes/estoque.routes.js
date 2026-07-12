/**
 * Arquivo: estoque.routes.js
 * Responsabilidade: Definir os endpoints /api/estoque (NF-e, itens pendentes
 * e movimentações) e encadear middlewares e controller.
 */
const { Router } = require('express');
const controller = require('../controllers/estoque.controller');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');
const { uploadXml } = require('../middlewares/upload');

const router = Router();
router.use(auth);

const gestao = exigePermissao('estoque');

router.post('/nfe/upload', gestao, uploadXml.single('arquivo'), controller.uploadNfe);
router.post('/nfe/confirmar/:nfeId', gestao, controller.confirmarNfe);
router.get('/nfe', gestao, controller.listarNfes);
router.get('/nfe/:id', gestao, controller.detalharNfe);
router.post('/nfe/:nfeId/itens/:itemId/vincular', gestao, controller.vincularItem);
router.get('/movimentacoes', gestao, controller.movimentacoes);
router.get('/pendentes', gestao, controller.pendentes);
router.get('/alertas-validade', gestao, controller.alertasValidade);
router.post('/promocoes-relampago/gerar', gestao, controller.gerarPromocoesRelampago);
router.post('/ajuste', gestao, controller.ajustar);
router.post('/transferencia', gestao, controller.transferir);
router.post('/transformacao', gestao, controller.transformar);

module.exports = router;
