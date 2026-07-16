/**
 * Arquivo: produto.routes.js
 * Responsabilidade: Definir os endpoints /api/produtos e encadear middlewares
 * (auth, permissao, upload, validators) e controller. Nenhuma lógica de negócio aqui.
 */
const { Router } = require('express');
const controller = require('../controllers/produto.controller');
const validator = require('../validators/produto.validator');
const { auth } = require('../middlewares/auth');
const { exigePermissao } = require('../middlewares/permissao.middleware');
const { uploadPlanilha } = require('../middlewares/upload');

const router = Router();
router.use(auth);

const gestao = exigePermissao('produtos');

// Rotas fixas antes de /:id
router.get('/exportar/modelo', gestao, controller.baixarModelo);
router.post('/importar/preview', gestao, uploadPlanilha.single('arquivo'), controller.importarPreview);
router.post('/importar/confirmar', gestao, controller.importarConfirmar);
router.get('/sync', gestao, controller.sync);
router.get('/estoque/alertas', gestao, controller.alertas);
router.get('/categorias', gestao, controller.listarCategorias);
router.patch('/em-lote', gestao, validator.emLote, controller.atualizarEmLote);
router.get('/catalogos/ncm', gestao, controller.buscarCatalogoNcm);
router.get('/catalogos/cfop', gestao, controller.buscarCatalogoCfop);
router.get('/catalogos/cst-ibs-cbs', gestao, controller.buscarCatalogoCstIbsCbs);
router.get('/catalogos/class-trib', gestao, controller.buscarCatalogoClassTrib);

router.get('/', gestao, controller.listar);
router.get('/:id', gestao, controller.detalhar);
router.get('/:id/ultima-compra', gestao, controller.ultimaCompra);
router.post('/', gestao, validator.criar, controller.criar);
router.put('/:id', gestao, validator.atualizar, controller.atualizar);
router.delete('/:id', gestao, controller.remover);

module.exports = router;
