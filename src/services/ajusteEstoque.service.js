/**
 * Arquivo: ajusteEstoque.service.js
 * Responsabilidade: Ajuste de estoque manual auditável (Fase 2c) — corrige
 * a quantidade de um produto num depósito (ou de um lote específico, se o
 * produto controla lote) para um valor ABSOLUTO informado (resultado de
 * contagem física ou correção), e grava o rastro em MovimentacaoEstoque
 * (tipo='ajuste'). Nunca aplica delta — sempre recebe e grava o valor final.
 * Utilizado por: EstoqueController (endpoint manual) e InventarioService
 * (fechamento automático de divergências em produto sem lote).
 * Depende de: ProdutoRepository, EstoqueDepositoRepository, LoteRepository.
 */
const prisma = require('../config/database');
const produtoRepo = require('../repositories/produto.repository');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const loteRepo = require('../repositories/lote.repository');
const { AppError } = require('../utils/response');

/**
 * Exige motivo como string não-vazia (mínimo 5 caracteres) — reaproveitada
 * por TransferenciaService e TransformacaoService (Fase 2d), que têm a
 * mesma exigência de justificativa auditável.
 */
function validarMotivo(motivo) {
  const motivoLimpo = String(motivo || '').trim();
  if (motivoLimpo.length < 5)
    throw new AppError('Informe um motivo (mínimo 5 caracteres)', 422);
  return motivoLimpo;
}

/**
 * Ajusta o estoque de um produto pra `novaQuantidade` (valor final, não
 * delta), registrando o motivo em MovimentacaoEstoque. `loteId` é
 * obrigatório quando o produto controla lote (ajusta ESSE lote
 * especificamente) e proibido quando não controla (ajusta o agregado
 * direto) — evita confusão sobre o que está sendo corrigido.
 */
async function ajusteEstoque(tenantId, usuarioId, produtoId, depositoId, novaQuantidade, motivo, loteId, origem = 'ajuste_manual', origemId = null) {
  const motivoLimpo = validarMotivo(motivo);

  const produto = await produtoRepo.buscarPorId(tenantId, produtoId);
  if (!produto || !produto.ativo) throw new AppError('Produto não encontrado neste supermercado', 404);

  const deposito = await estoqueDepositoRepo.buscarPorId(tenantId, depositoId);
  if (!deposito) throw new AppError('Depósito não encontrado neste supermercado', 404);

  if (produto.controlaLote && !loteId)
    throw new AppError(`Produto ${produto.nome} controla lote/validade — informe o loteId a ajustar`, 422);
  if (!produto.controlaLote && loteId)
    throw new AppError(`Produto ${produto.nome} não controla lote/validade — não informe loteId`, 422);

  const novaQtd = Number(novaQuantidade);

  return prisma.$transaction(async (tx) => {
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(tx, produtoId, depositoId);

    let quantidadeAnterior;
    if (produto.controlaLote) {
      const lote = await loteRepo.buscarPorId(tx, loteId);
      if (!lote || lote.estoqueProdutoId !== estoqueProduto.id)
        throw new AppError('Lote não pertence a este produto/depósito', 422);
      quantidadeAnterior = Number(lote.quantidade);

      if (novaQtd < 0 && !estoqueProduto.permiteEstoqueNegativo)
        throw new AppError(`Ajuste resultaria em quantidade negativa para ${produto.nome}, e o produto não permite estoque negativo`, 422);

      await loteRepo.atualizarQuantidade(tx, loteId, novaQtd);
      await loteRepo.recalcularEstoqueProdutoDeLotes(tx, estoqueProduto.id, produtoId);
    } else {
      quantidadeAnterior = Number(estoqueProduto.quantidade);

      if (novaQtd < 0 && !estoqueProduto.permiteEstoqueNegativo)
        throw new AppError(`Ajuste resultaria em quantidade negativa para ${produto.nome}, e o produto não permite estoque negativo`, 422);

      await estoqueDepositoRepo.definirQuantidade(tx, tenantId, produtoId, depositoId, novaQtd);
    }

    return tx.movimentacaoEstoque.create({
      data: {
        tenantId,
        produtoId,
        tipo: 'ajuste',
        quantidade: novaQtd - quantidadeAnterior,
        quantidadeAnterior,
        quantidadeNova: novaQtd,
        origem,
        origemId,
        usuarioId,
        observacao: motivoLimpo,
        depositoId,
        loteId: loteId || null,
      },
    });
  });
}

module.exports = { ajusteEstoque, validarMotivo };
