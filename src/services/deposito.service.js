/**
 * Arquivo: deposito.service.js
 * Responsabilidade: Regra de negócio de cadastro/listagem de Depósito
 * (Fase 2a — fundação de múltiplos depósitos). Criação sempre nasce com
 * principal=false: o Depósito Principal é criado só pelo backfill/autocura
 * (ver estoqueDeposito.repository.garantirDepositoPrincipal).
 * Utilizado por: DepositoController.
 * Depende de: EstoqueDepositoRepository, AuditoriaRepository.
 */
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { AppError } = require('../utils/response');

async function listar(tenantId) {
  return estoqueDepositoRepo.listarDepositos(tenantId);
}

async function criar(tenantId, body, usuario, ip) {
  const nome = body.nome.trim();
  const existente = await estoqueDepositoRepo.buscarPorNome(tenantId, nome);
  if (existente) throw new AppError('Já existe um depósito com este nome', 409);

  const deposito = await estoqueDepositoRepo.criarDeposito(tenantId, nome);
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'Deposito',
    entidadeId: deposito.id, depois: { nome: deposito.nome }, ip,
  });
  return deposito;
}

async function buscarOuFalhar(tenantId, id) {
  const deposito = await estoqueDepositoRepo.buscarPorId(tenantId, id);
  if (!deposito) throw new AppError('Depósito não encontrado', 404);
  return deposito;
}

/**
 * Renomeia o depósito. NÃO permite alterar `principal` por este endpoint —
 * trocar qual depósito é o principal exige promover um novo ao mesmo tempo
 * que desmarca o atual (garantir exatamente 1 sempre), o que fica pra um
 * refinamento futuro. Qualquer tentativa de mexer em `principal` aqui é
 * rejeitada, não importa o valor enviado.
 */
async function atualizar(tenantId, id, body, usuario, ip) {
  const deposito = await buscarOuFalhar(tenantId, id);
  if (body.principal !== undefined)
    throw new AppError('Alterar qual depósito é o principal ainda não é suportado.', 422);

  const nome = body.nome !== undefined ? body.nome.trim() : undefined;
  if (nome !== undefined && nome !== deposito.nome) {
    const existente = await estoqueDepositoRepo.buscarPorNome(tenantId, nome);
    if (existente && existente.id !== id) throw new AppError('Já existe um depósito com este nome', 409);
    await estoqueDepositoRepo.atualizarNome(tenantId, id, nome);
  }

  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'editar', entidade: 'Deposito',
    entidadeId: id, antes: { nome: deposito.nome }, depois: { nome: nome ?? deposito.nome }, ip,
  });
  return estoqueDepositoRepo.buscarPorId(tenantId, id);
}

/** Soft delete. O depósito principal nunca pode ser excluído (tem que existir exatamente 1 por tenant). */
async function remover(tenantId, id, usuario, ip) {
  const deposito = await buscarOuFalhar(tenantId, id);
  if (deposito.principal) throw new AppError('Não é possível excluir o depósito principal do tenant.', 409);

  await estoqueDepositoRepo.desativarDeposito(tenantId, id);
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'excluir', entidade: 'Deposito',
    entidadeId: id, antes: { nome: deposito.nome }, ip,
  });
  return { removido: true };
}

module.exports = { listar, criar, atualizar, remover };
