/**
 * Arquivo: fornecedor.service.js
 * Responsabilidade: Centralizar toda regra de negócio de fornecedores
 * (CRUD com soft delete e CNPJ válido e único por tenant).
 * Utilizado por: FornecedorController, EstoqueService.
 * Depende de: FornecedorRepository, AuditoriaRepository, utils/cnpj.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const fornecedorRepo = require('../repositories/fornecedor.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { limparCnpj } = require('../utils/cnpj');
const { AppError, paginado } = require('../utils/response');

async function listar(tenantId, query, pag) {
  const { items, total } = await fornecedorRepo.listar(tenantId, query, pag);
  return paginado(items, total, pag.page, pag.limit);
}

async function detalhar(tenantId, id) {
  const fornecedor = await fornecedorRepo.buscarPorId(tenantId, id);
  if (!fornecedor) throw new AppError('Fornecedor não encontrado', 404);
  return fornecedor;
}

async function criar(tenantId, body, usuario, ip) {
  const cnpj = limparCnpj(body.cnpj);
  const existente = await fornecedorRepo.buscarPorCnpj(tenantId, cnpj);
  if (existente) throw new AppError('Já existe um fornecedor com este CNPJ neste supermercado', 409);

  const fornecedor = await fornecedorRepo.criar({
    tenantId, nome: body.nome, cnpj,
    email: body.email || null, telefone: body.telefone || null,
  });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'Fornecedor',
    entidadeId: fornecedor.id, depois: { nome: fornecedor.nome, cnpj: fornecedor.cnpj }, ip,
  });
  return fornecedor;
}

async function atualizar(tenantId, id, body, usuario, ip) {
  const atual = await detalhar(tenantId, id);
  const dados = {};
  if (body.nome) dados.nome = body.nome;
  if (body.email !== undefined) dados.email = body.email || null;
  if (body.telefone !== undefined) dados.telefone = body.telefone || null;
  if (body.cnpj) {
    const cnpj = limparCnpj(body.cnpj);
    if (cnpj !== atual.cnpj) {
      const existente = await fornecedorRepo.buscarPorCnpj(tenantId, cnpj);
      if (existente && existente.id !== id)
        throw new AppError('Já existe um fornecedor com este CNPJ neste supermercado', 409);
    }
    dados.cnpj = cnpj;
  }
  const fornecedor = await fornecedorRepo.atualizar(id, dados);
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'editar', entidade: 'Fornecedor', entidadeId: id,
    antes: { nome: atual.nome, cnpj: atual.cnpj }, depois: { nome: fornecedor.nome, cnpj: fornecedor.cnpj }, ip,
  });
  return fornecedor;
}

async function remover(tenantId, id, usuario, ip) {
  const atual = await detalhar(tenantId, id);
  await fornecedorRepo.atualizar(id, { ativo: false });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'excluir', entidade: 'Fornecedor',
    entidadeId: id, antes: { nome: atual.nome }, ip,
  });
  return { removido: true };
}

module.exports = { listar, detalhar, criar, atualizar, remover };
