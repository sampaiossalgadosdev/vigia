/**
 * Arquivo: contaPagar.service.js
 * Responsabilidade: Regra de negócio de Contas a Pagar (Fase 4a) — criação
 * validada, listagem com filtro de vencimento, baixa (pago) e cancelamento
 * (exige motivo, mesmo padrão do ajuste de estoque).
 * Utilizado por: ContaPagarController.
 * Depende de: ContaPagarRepository, FornecedorRepository, AuditoriaRepository.
 */
const contaPagarRepo = require('../repositories/contaPagar.repository');
const fornecedorRepo = require('../repositories/fornecedor.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { validarMotivo } = require('./ajusteEstoque.service');
const { AppError, paginado } = require('../utils/response');

async function criar(tenantId, body, usuario, ip) {
  const descricao = String(body.descricao || '').trim();
  if (descricao.length < 3) throw new AppError('Descrição é obrigatória (mínimo 3 caracteres)', 422);

  const valor = Number(body.valor);
  if (!(valor > 0)) throw new AppError('Valor deve ser maior que zero', 422);

  if (!body.dataVencimento) throw new AppError('Data de vencimento é obrigatória', 422);
  const dataVencimento = new Date(body.dataVencimento);
  if (Number.isNaN(dataVencimento.getTime())) throw new AppError('Data de vencimento inválida', 422);

  if (body.fornecedorId) {
    const fornecedor = await fornecedorRepo.buscarPorId(tenantId, body.fornecedorId);
    if (!fornecedor) throw new AppError('Fornecedor não encontrado neste supermercado', 422);
  }

  const conta = await contaPagarRepo.criar({
    tenantId, fornecedorId: body.fornecedorId || null, descricao, valor, dataVencimento,
    observacao: body.observacao || null, criadoPorId: usuario.id,
  });
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'ContaPagar', entidadeId: conta.id, depois: { descricao, valor: String(valor) }, ip });
  return conta;
}

async function listar(tenantId, query, pag) {
  const { items, total } = await contaPagarRepo.listar(tenantId, query, pag);
  return paginado(items, total, pag.page, pag.limit);
}

async function detalhar(tenantId, id) {
  const conta = await contaPagarRepo.buscarPorId(tenantId, id);
  if (!conta) throw new AppError('Conta a pagar não encontrada', 404);
  return conta;
}

async function darBaixa(tenantId, id, body, usuario, ip) {
  const conta = await detalhar(tenantId, id);
  if (conta.status !== 'aberto') throw new AppError(`Conta já está ${conta.status}, não pode ser baixada`, 409);

  const dataPagamento = body.dataPagamento ? new Date(body.dataPagamento) : new Date();
  if (Number.isNaN(dataPagamento.getTime())) throw new AppError('Data de pagamento inválida', 422);

  const atualizada = await contaPagarRepo.darBaixa(tenantId, id, {
    status: 'pago', dataPagamento, formaPagamento: body.formaPagamento || null,
  });
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'baixar', entidade: 'ContaPagar', entidadeId: id, depois: { dataPagamento: dataPagamento.toISOString(), formaPagamento: body.formaPagamento || null }, ip });
  return atualizada;
}

async function cancelar(tenantId, id, motivo, usuario, ip) {
  const motivoLimpo = validarMotivo(motivo);
  const conta = await detalhar(tenantId, id);
  if (conta.status !== 'aberto') throw new AppError(`Conta já está ${conta.status}, não pode ser cancelada`, 409);

  const observacao = conta.observacao ? `${conta.observacao} | Cancelado: ${motivoLimpo}` : `Cancelado: ${motivoLimpo}`;
  const atualizada = await contaPagarRepo.cancelar(tenantId, id, observacao);
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'cancelar', entidade: 'ContaPagar', entidadeId: id, depois: { motivo: motivoLimpo }, ip });
  return atualizada;
}

module.exports = { criar, listar, detalhar, darBaixa, cancelar };
