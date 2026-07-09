/**
 * Arquivo: superadmin.controller.js
 * Responsabilidade: Receber req/res das rotas do superadmin e delegar ao
 * SuperadminService e ImportacaoService. Nunca acessa o Prisma.
 * Utilizado por: superadmin.routes.js.
 */
const service = require('../services/superadmin.service');
const importacao = require('../services/importacao.service');
const { success, asyncHandler, lerPaginacao } = require('../utils/response');

const login = asyncHandler(async (req, res) => {
  success(res, await service.login(req.body.email, req.body.senha));
});

const listarTenants = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.listarTenants(req.query, pag));
});

const criarTenant = asyncHandler(async (req, res) => {
  success(res, await service.criarTenant(req.body), 201);
});

const atualizarTenant = asyncHandler(async (req, res) => {
  success(res, await service.atualizarTenant(req.params.id, req.body));
});

const statsTenant = asyncHandler(async (req, res) => {
  success(res, await service.statsTenant(req.params.id));
});

const salvarCertificado = asyncHandler(async (req, res) => {
  success(res, await service.salvarCertificado(req.params.id, req.file, req.body.senha));
});

const modeloProdutos = asyncHandler(async (req, res) => {
  await service.validarTenantExiste(req.params.id);
  const buffer = importacao.modelo();
  res.setHeader('Content-Disposition', 'attachment; filename="modelo.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

const importarPreview = asyncHandler(async (req, res) => {
  await service.validarTenantExiste(req.params.id);
  success(res, await importacao.preview(req.params.id, req.file));
});

const importarConfirmar = asyncHandler(async (req, res) => {
  await service.validarTenantExiste(req.params.id);
  success(res, await importacao.confirmar(req.params.id, req.body.tokenImportacao, null, req.ip));
});

const listarSuperusuarios = asyncHandler(async (req, res) => {
  const pag = lerPaginacao(req.query);
  success(res, await service.listarSuperusuarios(pag));
});

const criarSuperusuario = asyncHandler(async (req, res) => {
  success(res, await service.criarSuperusuario(req.body), 201);
});

const atualizarSuperusuario = asyncHandler(async (req, res) => {
  success(res, await service.atualizarSuperusuario(req.params.id, req.body));
});

const atrelarTenants = asyncHandler(async (req, res) => {
  success(res, await service.atrelarTenants(req.params.id, req.body.tenantIds), 201);
});

const desatrelarTenant = asyncHandler(async (req, res) => {
  success(res, await service.desatrelarTenant(req.params.id, req.params.tenantId));
});

module.exports = {
  login, listarTenants, criarTenant, atualizarTenant, salvarCertificado, statsTenant,
  modeloProdutos, importarPreview, importarConfirmar,
  listarSuperusuarios, criarSuperusuario, atualizarSuperusuario,
  atrelarTenants, desatrelarTenant,
};
