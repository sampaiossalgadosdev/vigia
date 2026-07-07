/**
 * Arquivo: usuario.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para Usuario e RefreshToken.
 * Utilizado por: UsuarioService, AuthService.
 * Não contém regra de negócio.
 */
const prisma = require('../config/database');

async function listar(tenantId, { skip, take, order }) {
  const where = { tenantId, ativo: true };
  const [items, total] = await Promise.all([
    prisma.usuario.findMany({
      where, skip, take, orderBy: { nome: order },
      select: {
        id: true, nome: true, email: true, isDono: true, ativo: true, criadoEm: true,
        perfil: { select: { id: true, nome: true } },
      },
    }),
    prisma.usuario.count({ where }),
  ]);
  return { items, total };
}

async function buscarPorId(tenantId, id) {
  return prisma.usuario.findFirst({
    where: { id, tenantId },
    include: { tenant: true, perfil: { include: { permissoes: true } } },
  });
}

async function buscarPorEmailGlobal(email) {
  return prisma.usuario.findMany({
    where: { email, ativo: true },
    include: { tenant: true, perfil: { include: { permissoes: true } } },
  });
}

async function buscarPorEmailNoTenant(tenantId, email) {
  return prisma.usuario.findFirst({ where: { tenantId, email } });
}

async function criar(dados) {
  return prisma.usuario.create({ data: dados });
}

async function atualizar(id, dados) {
  return prisma.usuario.update({ where: { id }, data: dados });
}

// ─── Refresh tokens ───────────────────────────────────────
async function salvarRefreshToken({ id, tenantId, usuarioId, tokenHash, expiresAt }) {
  return prisma.refreshToken.create({
    data: { id, tenantId, usuarioId, token: tokenHash, expiresAt },
  });
}

async function buscarRefreshToken(id) {
  return prisma.refreshToken.findUnique({ where: { id } });
}

async function deletarRefreshToken(id) {
  return prisma.refreshToken.deleteMany({ where: { id } });
}

async function deletarRefreshTokensExpirados() {
  return prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

module.exports = {
  listar, buscarPorId, buscarPorEmailGlobal, buscarPorEmailNoTenant, criar, atualizar,
  salvarRefreshToken, buscarRefreshToken, deletarRefreshToken, deletarRefreshTokensExpirados,
};
