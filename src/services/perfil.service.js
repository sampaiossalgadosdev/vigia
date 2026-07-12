/**
 * Arquivo: perfil.service.js
 * Responsabilidade: Regra de negócio dos Perfis customizáveis do tenant
 * (CRUD com matriz de permissões por módulo, soft delete e auditoria).
 * Utilizado por: PerfilController.
 * Depende de: PerfilRepository, AuditoriaRepository.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const perfilRepo = require('../repositories/perfil.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { AppError, paginado } = require('../utils/response');
const { MODULOS } = require('../utils/modulos');

/**
 * Completa a matriz recebida do cliente com todos os módulos do sistema,
 * usando 'bloqueado' para qualquer módulo não informado.
 */
function normalizarPermissoes(permissoesBody = []) {
  const porModulo = new Map(permissoesBody.map((p) => [p.modulo, p.nivel]));
  return MODULOS.map((modulo) => ({ modulo, nivel: porModulo.get(modulo) || 'bloqueado' }));
}

/**
 * Só o Dono do tenant pode conceder nível acesso_completo em qualquer módulo —
 * sem isso, um usuário não-Dono com acesso à tela de Perfis poderia criar ou
 * editar um Perfil com acesso_completo (inclusive no módulo "usuarios"),
 * escalando o próprio privilégio.
 */
function garantirPodeConcederAcessoCompleto(permissoes, solicitante) {
  if (permissoes && permissoes.some((p) => p.nivel === 'acesso_completo') && !solicitante.isDono)
    throw new AppError('Apenas o proprietário da conta pode conceder o nível de acesso completo', 403);
}

async function listar(tenantId, pag) {
  const { items, total } = await perfilRepo.listar(tenantId, pag);
  return paginado(
    items.map((p) => ({ ...p, totalUsuarios: p._count.usuarios, _count: undefined })),
    total, pag.page, pag.limit
  );
}

async function detalhar(tenantId, id) {
  const perfil = await perfilRepo.buscarPorId(tenantId, id);
  if (!perfil) throw new AppError('Perfil não encontrado', 404);
  return perfil;
}

async function criar(tenantId, body, solicitante, ip) {
  const existente = await perfilRepo.buscarPorNome(tenantId, body.nome);
  if (existente) throw new AppError('Já existe um perfil com este nome', 409);

  const permissoes = normalizarPermissoes(body.permissoes);
  garantirPodeConcederAcessoCompleto(permissoes, solicitante);
  const perfil = await perfilRepo.criar(tenantId, { nome: body.nome, descricao: body.descricao, permissoes });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: solicitante.id, acao: 'criar', entidade: 'Perfil',
    entidadeId: perfil.id, depois: { nome: perfil.nome, permissoes }, ip,
  });
  return perfil;
}

async function atualizar(tenantId, id, body, solicitante, ip) {
  const atual = await perfilRepo.buscarPorId(tenantId, id);
  if (!atual) throw new AppError('Perfil não encontrado', 404);

  if (body.nome && body.nome !== atual.nome) {
    const existente = await perfilRepo.buscarPorNome(tenantId, body.nome);
    if (existente && existente.id !== id) throw new AppError('Já existe um perfil com este nome', 409);
  }

  const permissoes = body.permissoes ? normalizarPermissoes(body.permissoes) : undefined;
  garantirPodeConcederAcessoCompleto(permissoes, solicitante);
  const perfil = await perfilRepo.atualizar(tenantId, id, { nome: body.nome, descricao: body.descricao, permissoes });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: solicitante.id, acao: 'editar', entidade: 'Perfil', entidadeId: id,
    antes: { nome: atual.nome }, depois: { nome: perfil.nome, permissoes }, ip,
  });
  return perfil;
}

async function remover(tenantId, id, solicitante, ip) {
  const atual = await perfilRepo.buscarPorId(tenantId, id);
  if (!atual) throw new AppError('Perfil não encontrado', 404);

  const vinculados = await perfilRepo.contarUsuariosVinculados(id);
  if (vinculados > 0)
    throw new AppError('Existem usuários vinculados a este perfil. Troque o perfil deles antes de excluir.', 409);

  await perfilRepo.desativar(tenantId, id);
  await auditoriaRepo.registrar({
    tenantId, usuarioId: solicitante.id, acao: 'desativar', entidade: 'Perfil', entidadeId: id,
    antes: { nome: atual.nome }, ip,
  });
  return { removido: true };
}

module.exports = { listar, detalhar, criar, atualizar, remover };
