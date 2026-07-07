/**
 * Arquivo: perfil.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para Perfil e PermissaoPerfil.
 * Utilizado por: PerfilService, UsuarioService (validação de perfilId).
 * Não contém regra de negócio.
 */
const prisma = require('../config/database');

async function listar(tenantId, { skip, take, order }) {
  const where = { tenantId, ativo: true };
  const [items, total] = await Promise.all([
    prisma.perfil.findMany({
      where, skip, take, orderBy: { nome: order },
      include: { _count: { select: { usuarios: { where: { ativo: true } } } } },
    }),
    prisma.perfil.count({ where }),
  ]);
  return { items, total };
}

async function buscarPorId(tenantId, id) {
  return prisma.perfil.findFirst({
    where: { id, tenantId },
    include: { permissoes: true },
  });
}

async function buscarPorNome(tenantId, nome) {
  return prisma.perfil.findFirst({ where: { tenantId, nome } });
}

async function criar(tenantId, { nome, descricao, permissoes }) {
  return prisma.perfil.create({
    data: {
      tenantId, nome, descricao: descricao || null,
      permissoes: { create: permissoes },
    },
    include: { permissoes: true },
  });
}

async function atualizar(id, { nome, descricao, permissoes }) {
  return prisma.$transaction(async (tx) => {
    if (permissoes) {
      await tx.permissaoPerfil.deleteMany({ where: { perfilId: id } });
      await tx.permissaoPerfil.createMany({ data: permissoes.map((p) => ({ ...p, perfilId: id })) });
    }
    return tx.perfil.update({
      where: { id },
      data: { ...(nome !== undefined ? { nome } : {}), ...(descricao !== undefined ? { descricao } : {}) },
      include: { permissoes: true },
    });
  });
}

async function desativar(id) {
  return prisma.perfil.update({ where: { id }, data: { ativo: false } });
}

async function contarUsuariosVinculados(perfilId) {
  return prisma.usuario.count({ where: { perfilId, ativo: true } });
}

module.exports = { listar, buscarPorId, buscarPorNome, criar, atualizar, desativar, contarUsuariosVinculados };
