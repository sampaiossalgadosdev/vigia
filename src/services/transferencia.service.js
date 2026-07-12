/**
 * Arquivo: transferencia.service.js
 * Responsabilidade: Transferência de estoque de um produto entre dois
 * depósitos do mesmo tenant (Fase 2d). Reaproveita a mesma infraestrutura
 * do ajuste manual auditável (Fase 2c): validarMotivo, EstoqueDepositoRepository
 * (definirQuantidade/recalcularEstoqueAgregado) e LoteRepository, e o mesmo
 * formato de registro em MovimentacaoEstoque (quantidadeAnterior/Nova,
 * depositoId, loteId).
 * Utilizado por: EstoqueController.
 */
const crypto = require('crypto');
const prisma = require('../config/database');
const produtoRepo = require('../repositories/produto.repository');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const loteRepo = require('../repositories/lote.repository');
const { validarMotivo } = require('./ajusteEstoque.service');
const { AppError } = require('../utils/response');

/**
 * Move `quantidade` de um produto do depósito de origem pro de destino.
 * `loteId` é obrigatório quando o produto controla lote (precisa pertencer
 * ao depósito de origem) — no destino, a mesma identidade de lote
 * (numeroLote+dataValidade) é preservada: incrementa se já existir um
 * igual lá, senão cria um novo. Sem lote, ajusta o agregado direto dos
 * dois depósitos. Respeita permiteEstoqueNegativo da origem.
 */
async function transferirEstoque(tenantId, usuarioId, produtoId, depositoOrigemId, depositoDestinoId, quantidade, motivo, loteId) {
  const motivoLimpo = validarMotivo(motivo);

  if (depositoOrigemId === depositoDestinoId)
    throw new AppError('Depósito de origem e destino devem ser diferentes', 422);

  const qtd = Number(quantidade);
  if (!(qtd > 0)) throw new AppError('Quantidade a transferir deve ser maior que zero', 422);

  const produto = await produtoRepo.buscarPorId(tenantId, produtoId);
  if (!produto || !produto.ativo) throw new AppError('Produto não encontrado neste supermercado', 404);

  const depositoOrigem = await estoqueDepositoRepo.buscarPorId(tenantId, depositoOrigemId);
  if (!depositoOrigem) throw new AppError('Depósito de origem não encontrado neste supermercado', 404);
  const depositoDestino = await estoqueDepositoRepo.buscarPorId(tenantId, depositoDestinoId);
  if (!depositoDestino) throw new AppError('Depósito de destino não encontrado neste supermercado', 404);

  if (produto.controlaLote && !loteId)
    throw new AppError(`Produto ${produto.nome} controla lote/validade — informe o loteId a transferir`, 422);
  if (!produto.controlaLote && loteId)
    throw new AppError(`Produto ${produto.nome} não controla lote/validade — não informe loteId`, 422);

  // Identificador comum de transferência: mais simples que cruzar os ids
  // dos dois registros entre si (evitaria um update extra depois de criar
  // ambos) — origemId não tem FK, é só uma chave de agrupamento livre.
  const grupoTransferencia = crypto.randomUUID();

  return prisma.$transaction(async (tx) => {
    const estoqueOrigem = await estoqueDepositoRepo.garantirEstoqueProduto(tx, produtoId, depositoOrigemId);
    const estoqueDestino = await estoqueDepositoRepo.garantirEstoqueProduto(tx, produtoId, depositoDestinoId);

    let loteDestinoId = null;
    let origemAnterior, origemNova, destinoAnterior, destinoNova;

    if (produto.controlaLote) {
      const lote = await loteRepo.buscarPorId(tx, loteId);
      if (!lote || lote.estoqueProdutoId !== estoqueOrigem.id)
        throw new AppError('Lote não pertence a este produto/depósito de origem', 422);

      origemAnterior = Number(lote.quantidade);
      origemNova = origemAnterior - qtd;
      if (origemNova < 0 && !estoqueOrigem.permiteEstoqueNegativo)
        throw new AppError(`Estoque insuficiente para transferir ${produto.nome}, origem não permite estoque negativo`, 422);

      await loteRepo.atualizarQuantidade(tx, loteId, origemNova);
      await loteRepo.recalcularEstoqueProdutoDeLotes(tx, estoqueOrigem.id, produtoId);

      const loteExistenteDestino = await loteRepo.buscarPorNumeroEValidade(tx, estoqueDestino.id, lote.numeroLote, lote.dataValidade);
      if (loteExistenteDestino) {
        destinoAnterior = Number(loteExistenteDestino.quantidade);
        destinoNova = destinoAnterior + qtd;
        await loteRepo.atualizarQuantidade(tx, loteExistenteDestino.id, destinoNova);
        loteDestinoId = loteExistenteDestino.id;
      } else {
        destinoAnterior = 0;
        destinoNova = qtd;
        const novoLote = await loteRepo.criar(tx, estoqueDestino.id, { numeroLote: lote.numeroLote, dataValidade: lote.dataValidade, quantidade: qtd });
        loteDestinoId = novoLote.id;
      }
      await loteRepo.recalcularEstoqueProdutoDeLotes(tx, estoqueDestino.id, produtoId);
    } else {
      origemAnterior = Number(estoqueOrigem.quantidade);
      origemNova = origemAnterior - qtd;
      if (origemNova < 0 && !estoqueOrigem.permiteEstoqueNegativo)
        throw new AppError(`Estoque insuficiente para transferir ${produto.nome}, origem não permite estoque negativo`, 422);

      destinoAnterior = Number(estoqueDestino.quantidade);
      destinoNova = destinoAnterior + qtd;

      await estoqueDepositoRepo.definirQuantidade(tx, produtoId, depositoOrigemId, origemNova);
      await estoqueDepositoRepo.definirQuantidade(tx, produtoId, depositoDestinoId, destinoNova);
    }

    const movimentacaoSaida = await tx.movimentacaoEstoque.create({
      data: {
        tenantId, produtoId, tipo: 'transferencia', quantidade: -qtd,
        quantidadeAnterior: origemAnterior, quantidadeNova: origemNova,
        origem: 'transferencia', origemId: grupoTransferencia, usuarioId,
        observacao: motivoLimpo, depositoId: depositoOrigemId, loteId: loteId || null,
      },
    });
    const movimentacaoEntrada = await tx.movimentacaoEstoque.create({
      data: {
        tenantId, produtoId, tipo: 'transferencia', quantidade: qtd,
        quantidadeAnterior: destinoAnterior, quantidadeNova: destinoNova,
        origem: 'transferencia', origemId: grupoTransferencia, usuarioId,
        observacao: motivoLimpo, depositoId: depositoDestinoId, loteId: loteDestinoId,
      },
    });

    return { saida: movimentacaoSaida, entrada: movimentacaoEntrada };
  });
}

module.exports = { transferirEstoque };
