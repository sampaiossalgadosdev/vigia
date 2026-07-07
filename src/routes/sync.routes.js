const { Router } = require('express');
const { auth } = require('../middlewares/auth');
const { success, asyncHandler } = require('../utils/response');
const produtoRepo = require('../repositories/produto.repository');
const promocaoRepo = require('../repositories/promocao.repository');
const vendaService = require('../services/venda.service');

const router = Router();
router.use(auth);

router.get('/produtos', asyncHandler(async (req, res) => {
  const desde = req.query.desde ? new Date(req.query.desde) : null;
  const produtos = await produtoRepo.sync(req.tenantId, desde);
  success(res, { produtos });
}));

router.get('/promocoes', asyncHandler(async (req, res) => {
  success(res, await promocaoRepo.vigentes(req.tenantId));
}));

router.get('/config', asyncHandler(async (req, res) => {
  success(res, { regimeTributario: 'simples' });
}));

router.post('/vendas', asyncHandler(async (req, res) => {
  success(res, await vendaService.sync(req.tenantId, req.body.vendas || []));
}));

router.post('/estoque-negativo', asyncHandler(async (req, res) => {
  success(res, { ok: true });
}));

module.exports = router;