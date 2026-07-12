/**
 * Arquivo: superadmin.routes.js
 * Responsabilidade: Definir os endpoints /api/superadmin (login, tenants,
 * superusuários, importação de produtos por tenant).
 */
const { Router } = require('express');
const controller = require('../controllers/superadmin.controller');
const validator = require('../validators/auth.validator');
const { authAdmin } = require('../middlewares/authAdmin');
const { uploadPlanilha, uploadPfx } = require('../middlewares/upload');

const router = Router();

router.post('/login', validator.login, controller.login);

router.use(authAdmin);

router.get('/tenants', controller.listarTenants);
router.post('/tenants', controller.criarTenant);
router.put('/tenants/:id', controller.atualizarTenant);
router.get('/tenants/:id/stats', controller.statsTenant);
router.post('/tenants/:id/certificado', uploadPfx.single('certificado'), controller.salvarCertificado);
router.put('/tenants/:id/configuracao-fiscal', controller.salvarConfiguracaoFiscal);
router.get('/tenants/:id/configuracao-fiscal/completa', controller.configuracaoFiscalCompleta);
router.get('/tenants/:id/produtos/modelo', controller.modeloProdutos);
router.post('/tenants/:id/produtos/importar/preview', uploadPlanilha.single('arquivo'), controller.importarPreview);
router.post('/tenants/:id/produtos/importar/confirmar', controller.importarConfirmar);

router.get('/superusuarios', controller.listarSuperusuarios);
router.post('/superusuarios', controller.criarSuperusuario);
router.put('/superusuarios/:id', controller.atualizarSuperusuario);
router.post('/superusuarios/:id/tenants', controller.atrelarTenants);
router.delete('/superusuarios/:id/tenants/:tenantId', controller.desatrelarTenant);

module.exports = router;
