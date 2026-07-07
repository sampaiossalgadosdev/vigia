/**
 * Arquivo: superadmin.service.js
 * Responsabilidade: Regra de negócio do painel do dono do SaaS: login,
 * gestão de tenants (criação com dono opcional, planos, ativar/desativar,
 * stats), gestão de superusuários e vínculos com tenants.
 * Utilizado por: SuperadminController.
 * Depende de: SuperadminRepository, UsuarioRepository, AuditoriaRepository,
 * utils/jwt, utils/bcrypt, utils/cnpj.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const superadminRepo = require('../repositories/superadmin.repository');
const usuarioRepo = require('../repositories/usuario.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { gerarAccessToken } = require('../utils/jwt');
const { comparar, gerarHash } = require('../utils/bcrypt');
const { validarCnpj, limparCnpj } = require('../utils/cnpj');
const { AppError, paginado } = require('../utils/response');

const PLANOS = ['standard', 'pro'];

async function login(email, senha) {
  const admin = await superadminRepo.buscarAdminPorEmail(email);
  if (!admin || !admin.ativo || !(await comparar(senha, admin.senha)))
    throw new AppError('E-mail ou senha incorretos', 401);
  const accessToken = gerarAccessToken({ sub: admin.id }, 'admin');
  return { accessToken, superadmin: { id: admin.id, nome: admin.nome, email: admin.email } };
}

// ─── Tenants ──────────────────────────────────────────────
async function listarTenants(query, pag) {
  const incluirInativos = query.incluirInativos === 'true';
  const { items, total } = await superadminRepo.listarTenants(
    { ativo: query.ativo, plano: query.plano, incluirInativos },
    { skip: pag.skip, take: pag.limit, search: pag.search }
  );
  return paginado(items, total, pag.page, pag.limit);
}

/**
 * Cria um tenant. Se body.dono ({ nome, email, senha }) vier preenchido,
 * cria também o usuário dono inicial.
 */
async function criarTenant(body) {
  const cnpj = limparCnpj(body.cnpj);
  if (!validarCnpj(cnpj)) throw new AppError('CNPJ do tenant inválido', 422);
  if (!body.nome || !body.email) throw new AppError('Nome e e-mail do tenant são obrigatórios', 422);
  const existente = await superadminRepo.buscarTenantPorCnpj(cnpj);
  if (existente) throw new AppError('Já existe um tenant com este CNPJ', 409);

  if (body.plano && !PLANOS.includes(body.plano)) throw new AppError('Plano deve ser standard ou pro', 422);

  const tenant = await superadminRepo.criarTenant({
    nome: body.nome, cnpj, email: body.email, telefone: body.telefone || null,
    plano: body.plano || 'standard', regimeTributario: body.regimeTributario || 'simples',
  });

  let dono = null;
  if (body.dono && body.dono.email && body.dono.senha) {
    dono = await usuarioRepo.criar({
      tenantId: tenant.id,
      nome: body.dono.nome || 'Dono ' + tenant.nome,
      email: body.dono.email,
      senha: await gerarHash(body.dono.senha),
      isDono: true,
    });
  }
  await auditoriaRepo.registrar({
    tenantId: tenant.id, acao: 'criar', entidade: 'Tenant', entidadeId: tenant.id,
    depois: { nome: tenant.nome, cnpj: tenant.cnpj, plano: tenant.plano },
  });
  return { tenant, dono: dono ? { id: dono.id, email: dono.email } : null };
}

async function atualizarTenant(id, body) {
  const atual = await superadminRepo.buscarTenantPorId(id);
  if (!atual) throw new AppError('Tenant não encontrado', 404);

  const dados = {};
  if (body.nome) dados.nome = body.nome;
  if (body.email) dados.email = body.email;
  if (body.telefone !== undefined) dados.telefone = body.telefone || null;
  if (body.plano) {
    if (!PLANOS.includes(body.plano)) throw new AppError('Plano deve ser standard ou pro', 422);
    dados.plano = body.plano;
  }
  if (body.regimeTributario) dados.regimeTributario = body.regimeTributario;
  if (body.ativo !== undefined) dados.ativo = body.ativo === true || body.ativo === 'true';
  if (body.cnpj) {
    const cnpj = limparCnpj(body.cnpj);
    if (!validarCnpj(cnpj)) throw new AppError('CNPJ inválido', 422);
    const existente = await superadminRepo.buscarTenantPorCnpj(cnpj);
    if (existente && existente.id !== id) throw new AppError('Já existe um tenant com este CNPJ', 409);
    dados.cnpj = cnpj;
  }
  const tenant = await superadminRepo.atualizarTenant(id, dados);
  await auditoriaRepo.registrar({
    tenantId: id, acao: 'editar', entidade: 'Tenant', entidadeId: id,
    antes: { nome: atual.nome, plano: atual.plano, ativo: atual.ativo },
    depois: { nome: tenant.nome, plano: tenant.plano, ativo: tenant.ativo },
  });
  return tenant;
}

async function statsTenant(id) {
  const tenant = await superadminRepo.buscarTenantPorId(id);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);
  const stats = await superadminRepo.statsTenant(id);
  return { tenant: { id: tenant.id, nome: tenant.nome, plano: tenant.plano, ativo: tenant.ativo }, stats };
}

async function validarTenantExiste(id) {
  const tenant = await superadminRepo.buscarTenantPorId(id);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);
  return tenant;
}

// ─── Superusuários ────────────────────────────────────────
async function listarSuperusuarios(pag) {
  const { items, total } = await superadminRepo.listarSuperusuarios({
    skip: pag.skip, take: pag.limit, search: pag.search,
  });
  return paginado(items, total, pag.page, pag.limit);
}

async function criarSuperusuario(body) {
  if (!body.nome || !body.email || !body.senha)
    throw new AppError('Nome, e-mail e senha são obrigatórios', 422);
  const existente = await superadminRepo.buscarSuperusuarioPorEmail(body.email);
  if (existente) throw new AppError('Já existe um superusuário com este e-mail', 409);
  const criado = await superadminRepo.criarSuperusuario({
    nome: body.nome, email: body.email, senha: await gerarHash(body.senha),
  });
  const { senha, ...resto } = criado;
  return resto;
}

async function atualizarSuperusuario(id, body) {
  const atual = await superadminRepo.buscarSuperusuarioPorId(id);
  if (!atual) throw new AppError('Superusuário não encontrado', 404);
  const dados = {};
  if (body.nome) dados.nome = body.nome;
  if (body.email) dados.email = body.email;
  if (body.senha) dados.senha = await gerarHash(body.senha);
  if (body.ativo !== undefined) dados.ativo = body.ativo === true || body.ativo === 'true';
  const atualizado = await superadminRepo.atualizarSuperusuario(id, dados);
  const { senha, ...resto } = atualizado;
  return resto;
}

async function atrelarTenants(superusuarioId, tenantIds) {
  const superusuario = await superadminRepo.buscarSuperusuarioPorId(superusuarioId);
  if (!superusuario) throw new AppError('Superusuário não encontrado', 404);
  if (!Array.isArray(tenantIds) || tenantIds.length === 0)
    throw new AppError('Informe tenantIds (array) para atrelar', 422);
  for (const tenantId of tenantIds) await validarTenantExiste(tenantId);
  await superadminRepo.atrelarTenants(superusuarioId, tenantIds);
  return { atrelados: tenantIds.length };
}

async function desatrelarTenant(superusuarioId, tenantId) {
  const resultado = await superadminRepo.desatrelarTenant(superusuarioId, tenantId);
  if (resultado.count === 0) throw new AppError('Vínculo não encontrado', 404);
  return { desatrelado: true };
}

module.exports = {
  login, listarTenants, criarTenant, atualizarTenant, statsTenant, validarTenantExiste,
  listarSuperusuarios, criarSuperusuario, atualizarSuperusuario, atrelarTenants, desatrelarTenant,
};
