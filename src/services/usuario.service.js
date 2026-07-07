/**
 * Arquivo: usuario.service.js
 * Responsabilidade: Regra de negócio de usuários do tenant (CRUD com soft
 * delete, e-mail único por tenant, hash de senha e auditoria).
 * Utilizado por: UsuarioController.
 * Depende de: UsuarioRepository, AuditoriaRepository, utils/bcrypt.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const usuarioRepo = require('../repositories/usuario.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { gerarHash } = require('../utils/bcrypt');
const { AppError, paginado } = require('../utils/response');

function semSenha(usuario) {
  const { senha, ...resto } = usuario;
  return resto;
}

async function listar(tenantId, pag) {
  const { items, total } = await usuarioRepo.listar(tenantId, pag);
  return paginado(items, total, pag.page, pag.limit);
}

async function criar(tenantId, body, solicitante, ip) {
  const existente = await usuarioRepo.buscarPorEmailNoTenant(tenantId, body.email);
  if (existente) throw new AppError('Já existe um usuário com este e-mail neste supermercado', 409);

  const usuario = await usuarioRepo.criar({
    tenantId, nome: body.nome, email: body.email,
    senha: await gerarHash(body.senha), perfil: body.perfil,
  });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: solicitante.id, acao: 'criar', entidade: 'Usuario',
    entidadeId: usuario.id, depois: { nome: usuario.nome, email: usuario.email, perfil: usuario.perfil }, ip,
  });
  return semSenha(usuario);
}

async function atualizar(tenantId, id, body, solicitante, ip) {
  const atual = await usuarioRepo.buscarPorId(tenantId, id);
  if (!atual) throw new AppError('Usuário não encontrado', 404);

  const dados = {};
  if (body.nome) dados.nome = body.nome;
  if (body.perfil) dados.perfil = body.perfil;
  if (body.email && body.email !== atual.email) {
    const existente = await usuarioRepo.buscarPorEmailNoTenant(tenantId, body.email);
    if (existente && existente.id !== id)
      throw new AppError('Já existe um usuário com este e-mail neste supermercado', 409);
    dados.email = body.email;
  }
  if (body.senha) dados.senha = await gerarHash(body.senha);

  const usuario = await usuarioRepo.atualizar(id, dados);
  await auditoriaRepo.registrar({
    tenantId, usuarioId: solicitante.id, acao: 'editar', entidade: 'Usuario', entidadeId: id,
    antes: { nome: atual.nome, perfil: atual.perfil },
    depois: { nome: usuario.nome, perfil: usuario.perfil }, ip,
  });
  return semSenha(usuario);
}

/**
 * Soft delete. O dono não pode desativar a si mesmo.
 */
async function remover(tenantId, id, solicitante, ip) {
  if (id === solicitante.id) throw new AppError('Você não pode desativar o próprio usuário', 409);
  const atual = await usuarioRepo.buscarPorId(tenantId, id);
  if (!atual) throw new AppError('Usuário não encontrado', 404);

  await usuarioRepo.atualizar(id, { ativo: false });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: solicitante.id, acao: 'desativar', entidade: 'Usuario',
    entidadeId: id, antes: { nome: atual.nome, email: atual.email }, ip,
  });
  return { removido: true };
}

module.exports = { listar, criar, atualizar, remover };
