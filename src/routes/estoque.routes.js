/**
 * Arquivo: estoque.routes.js
 * Responsabilidade: Definir os endpoints /api/estoque (NF-e, itens pendentes
 * e movimentações) e encadear middlewares e controller.
 */
const { Router } = require('express');
const controller = require('../controllers/estoque.controller');
const { auth } = require('../middlewares/auth');
const { role } = require('../middlewares/role');
const { uploadXml } = require('../middlewares/upload');

const router = Router();
router.use(auth);

const gestao = role(['dono', 'gerente']);

router.post('/nfe/upload', gestao, uploadXml.single('arquivo'), controller.uploadNfe);
router.post('/nfe/confirmar/:nfeId', gestao, controller.confirmarNfe);
router.get('/nfe', controller.listarNfes);
router.get('/nfe/:id', controller.detalharNfe);
router.post('/nfe/:nfeId/itens/:itemId/vincular', gestao, controller.vincularItem);
router.get('/movimentacoes', controller.movimentacoes);
router.get('/pendentes', controller.pendentes);

module.exports = router;
