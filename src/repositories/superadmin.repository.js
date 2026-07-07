/**
 * Arquivo: superadmin.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para Superadmin, Tenant,
 * Superusuario e vínculos SuperusuarioTenant.
 * Utilizado por: SuperadminService.
 * Não contém regra de negócio.
 */
const prisma = require('../config/database');

async function buscarAdminPorEmail(email) {
  return prisma.superadmin.findUnique({ where: { email } });
}

async function listarTenants({ ativo, plano, incluirInativos }, { skip, take, search }) {
  const where = {};
  if (!incluirInativos) where.ativo = true;
  if (ativo === 'true') where.ativo = true;
  if (ativo === 'false') where.ativo = false;
  if (plano) where.plano = plano;
  if (search)
    where.OR = [
      { nome: { contains: search, mode: 'insensitive' } },
      { cnpj: { contains: search.replace(/\D/g, '') || search } },
    ];
  const [items, total] = await Promise.all([
    prisma.tenant.findMany({
      where, skip, take, orderBy: { nome: 'asc' },
      include: { _count: { select: { usuarios: true, produtos: true } } },
    }),
    prisma.tenant.count({ where }),
  ]);
  return { items, total };
}

async function buscarTenantPorId(id) {
  return prisma.tenant.findUnique({ where: { id } });
}

async function buscarTenantPorCnpj(cnpj) {
  return prisma.tenant.findUnique({ where: { cnpj } });
}

async function criarTenant(dados) {
  return prisma.tenant.create({ data: dados });
}

async function atualizarTenant(id, dados) {
  return prisma.tenant.update({ where: { id }, data: dados });
}

async function statsTenant(tenantId) {
  const [usuarios, produtos, fornecedores, nfes, movimentacoes, sugestoesPendentes] = await Promise.all([
    prisma.usuario.count({ where: { tenantId, ativo: true } }),
    prisma.produto.count({ where: { tenantId, ativo: true } }),
    prisma.fornecedor.count({ where: { tenantId, ativo: true } }),
    prisma.nfe.count({ where: { tenantId } }),
    prisma.movimentacaoEstoque.count({ where: { tenantId } }),
    prisma.sugestao.count({ where: { tenantId, status: 'pendente' } }),
  ]);
  return { usuarios, produtos, fornecedores, nfes, movimentacoes, sugestoesPendentes };
}

// ─── Superusuários ────────────────────────────────────────
async function listarSuperusuarios({ skip, take, search }) {
  const where = {};
  if (search) where.OR = [{ nome: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }];
  const [items, total] = await Promise.all([
    prisma.superusuario.findMany({
      where, skip, take, orderBy: { nome: 'asc' },
      select: {
        id: true, nome: true, email: true, ativo: true, criadoEm: true,
        redes: { select: { tenantId: true, tenant: { select: { id: true, nome: true } } } },
      },
    }),
    prisma.superusuario.count({ where }),
  ]);
  return { items, total };
}

async function buscarSuperusuarioPorId(id) {
  return prisma.superusuario.findUnique({ where: { id }, include: { redes: true } });
}

async function buscarSuperusuarioPorEmail(email) {
  return prisma.superusuario.findUnique({ where: { email } });
}

async function criarSuperusuario(dados) {
  return prisma.superusuario.create({ data: dados });
}

async function atualizarSuperusuario(id, dados) {
  return prisma.superusuario.update({ where: { id }, data: dados });
}

async function atrelarTenants(superusuarioId, tenantIds) {
  return prisma.superusuarioTenant.createMany({
    data: tenantIds.map((tenantId) => ({ superusuarioId, tenantId })),
    skipDuplicates: true,
  });
}

async function desatrelarTenant(superusuarioId, tenantId) {
  return prisma.superusuarioTenant.deleteMany({ where: { superusuarioId, tenantId } });
}

module.exports = {
  buscarAdminPorEmail, listarTenants, buscarTenantPorId, buscarTenantPorCnpj,
  criarTenant, atualizarTenant, statsTenant, listarSuperusuarios,
  buscarSuperusuarioPorId, buscarSuperusuarioPorEmail, criarSuperusuario,
  atualizarSuperusuario, atrelarTenants, desatrelarTenant,
};
