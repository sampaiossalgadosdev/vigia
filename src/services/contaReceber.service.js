/**
 * Arquivo: contaReceber.service.js
 * Responsabilidade: Regra de negócio de Contas a Receber (Fase 4a) —
 * criação validada, listagem com filtro de vencimento, baixa (recebido) e
 * cancelamento (exige motivo, mesmo padrão do ajuste de estoque).
 * Utilizado por: ContaReceberController.
 * Depende de: ContaReceberRepository, VendaRepository, AuditoriaRepository.
 */
const contaReceberRepo = require('../repositories/contaReceber.repository');
const vendaRepo = require('../repositories/venda.repository');
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

  if (body.vendaId) {
    const venda = await vendaRepo.buscarPorId(tenantId, body.vendaId);
    if (!venda) throw new AppError('Venda não encontrada neste supermercado', 422);
  }

  const conta = await contaReceberRepo.criar({
    tenantId, vendaId: body.vendaId || null, descricao, valor, dataVencimento,
    observacao: body.observacao || null, criadoPorId: usuario.id,
  });
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'ContaReceber', entidadeId: conta.id, depois: { descricao, valor: String(valor) }, ip });
  return conta;
}

async function listar(tenantId, query, pag) {
  const { items, total } = await contaReceberRepo.listar(tenantId, query, pag);
  return paginado(items, total, pag.page, pag.limit);
}

async function detalhar(tenantId, id) {
  const conta = await contaReceberRepo.buscarPorId(tenantId, id);
  if (!conta) throw new AppError('Conta a receber não encontrada', 404);
  return conta;
}

async function darBaixa(tenantId, id, body, usuario, ip) {
  const conta = await detalhar(tenantId, id);
  if (conta.status !== 'aberto') throw new AppError(`Conta já está ${conta.status}, não pode ser baixada`, 409);

  const dataRecebimento = body.dataRecebimento ? new Date(body.dataRecebimento) : new Date();
  if (Number.isNaN(dataRecebimento.getTime())) throw new AppError('Data de recebimento inválida', 422);

  const atualizada = await contaReceberRepo.darBaixa(tenantId, id, {
    status: 'recebido', dataRecebimento, formaRecebimento: body.formaRecebimento || null,
  });
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'baixar', entidade: 'ContaReceber', entidadeId: id, depois: { dataRecebimento: dataRecebimento.toISOString(), formaRecebimento: body.formaRecebimento || null }, ip });
  return atualizada;
}

async function cancelar(tenantId, id, motivo, usuario, ip) {
  const motivoLimpo = validarMotivo(motivo);
  const conta = await detalhar(tenantId, id);
  if (conta.status !== 'aberto') throw new AppError(`Conta já está ${conta.status}, não pode ser cancelada`, 409);

  const observacao = conta.observacao ? `${conta.observacao} | Cancelado: ${motivoLimpo}` : `Cancelado: ${motivoLimpo}`;
  const atualizada = await contaReceberRepo.cancelar(tenantId, id, observacao);
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'cancelar', entidade: 'ContaReceber', entidadeId: id, depois: { motivo: motivoLimpo }, ip });
  return atualizada;
}

module.exports = { criar, listar, detalhar, darBaixa, cancelar };
