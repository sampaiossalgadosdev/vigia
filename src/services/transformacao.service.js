/**
 * Arquivo: transformacao.service.js
 * Responsabilidade: Transformação de um produto em outro dentro do mesmo
 * depósito (Fase 2d) — ex: peixe inteiro processado em filé. Reaproveita a
 * mesma infraestrutura do ajuste manual auditável (Fase 2c): validarMotivo,
 * EstoqueDepositoRepository (definirQuantidade/recalcularEstoqueAgregado) e
 * LoteRepository (bloqueio de lote vencido, mesma regra da Fase 2b), e o
 * mesmo formato de registro em MovimentacaoEstoque.
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
 * Consome `quantidadeOrigemConsumida` do produto de origem e gera
 * `quantidadeDestinoGerada` do produto de destino, no mesmo depósito.
 * Lote na origem: obrigatório informar loteOrigemId; bloqueia se esse lote
 * já estiver vencido (mesma regra da venda, Fase 2b — não transforma
 * produto vencido silenciosamente). Lote no destino: dataValidadeDestino é
 * obrigatório (a validade do produto gerado pode ser bem diferente da
 * origem, não dá pra herdar automaticamente).
 */
async function transformarProduto(tenantId, usuarioId, produtoOrigemId, produtoDestinoId, depositoId, quantidadeOrigemConsumida, quantidadeDestinoGerada, motivo, loteOrigemId, dataValidadeDestino) {
  const motivoLimpo = validarMotivo(motivo);

  const qtdOrigem = Number(quantidadeOrigemConsumida);
  const qtdDestino = Number(quantidadeDestinoGerada);
  if (!(qtdOrigem > 0)) throw new AppError('quantidadeOrigemConsumida deve ser maior que zero', 422);
  if (!(qtdDestino > 0)) throw new AppError('quantidadeDestinoGerada deve ser maior que zero', 422);

  const produtoOrigem = await produtoRepo.buscarPorId(tenantId, produtoOrigemId);
  if (!produtoOrigem || !produtoOrigem.ativo) throw new AppError('Produto de origem não encontrado neste supermercado', 404);
  const produtoDestino = await produtoRepo.buscarPorId(tenantId, produtoDestinoId);
  if (!produtoDestino || !produtoDestino.ativo) throw new AppError('Produto de destino não encontrado neste supermercado', 404);

  const deposito = await estoqueDepositoRepo.buscarPorId(tenantId, depositoId);
  if (!deposito) throw new AppError('Depósito não encontrado neste supermercado', 404);

  if (produtoOrigem.controlaLote && !loteOrigemId)
    throw new AppError(`Produto ${produtoOrigem.nome} controla lote/validade — informe o loteOrigemId a consumir`, 422);
  if (!produtoOrigem.controlaLote && loteOrigemId)
    throw new AppError(`Produto ${produtoOrigem.nome} não controla lote/validade — não informe loteOrigemId`, 422);

  if (produtoDestino.controlaLote && !dataValidadeDestino)
    throw new AppError(`Produto ${produtoDestino.nome} controla lote/validade — informe dataValidadeDestino`, 422);

  // Mesmo padrão da transferência: identificador comum, mais simples que
  // cruzar os ids dos dois registros entre si.
  const grupoTransformacao = crypto.randomUUID();

  return prisma.$transaction(async (tx) => {
    const estoqueOrigem = await estoqueDepositoRepo.garantirEstoqueProduto(tx, produtoOrigemId, depositoId);
    const estoqueDestino = await estoqueDepositoRepo.garantirEstoqueProduto(tx, produtoDestinoId, depositoId);

    let origemAnterior, origemNova;
    if (produtoOrigem.controlaLote) {
      const lote = await loteRepo.buscarPorId(tx, loteOrigemId);
      if (!lote || lote.estoqueProdutoId !== estoqueOrigem.id)
        throw new AppError('Lote não pertence a este produto/depósito', 422);
      if (new Date(lote.dataValidade) < new Date())
        throw new AppError(`Produto ${produtoOrigem.nome} possui lote vencido em ${new Date(lote.dataValidade).toLocaleDateString('pt-BR')} — transformação bloqueada`, 422);

      origemAnterior = Number(lote.quantidade);
      origemNova = origemAnterior - qtdOrigem;
      if (origemNova < 0 && !estoqueOrigem.permiteEstoqueNegativo)
        throw new AppError(`Estoque insuficiente de ${produtoOrigem.nome} pra essa transformação, produto não permite estoque negativo`, 422);

      await loteRepo.atualizarQuantidade(tx, loteOrigemId, origemNova);
      await loteRepo.recalcularEstoqueProdutoDeLotes(tx, estoqueOrigem.id, produtoOrigemId);
    } else {
      origemAnterior = Number(estoqueOrigem.quantidade);
      origemNova = origemAnterior - qtdOrigem;
      if (origemNova < 0 && !estoqueOrigem.permiteEstoqueNegativo)
        throw new AppError(`Estoque insuficiente de ${produtoOrigem.nome} pra essa transformação, produto não permite estoque negativo`, 422);

      await estoqueDepositoRepo.definirQuantidade(tx, tenantId, produtoOrigemId, depositoId, origemNova);
    }

    let destinoAnterior, destinoNova, loteDestinoId = null;
    if (produtoDestino.controlaLote) {
      destinoAnterior = Number(estoqueDestino.quantidade);
      const novoLote = await loteRepo.criar(tx, estoqueDestino.id, { numeroLote: null, dataValidade: new Date(dataValidadeDestino), quantidade: qtdDestino });
      await loteRepo.recalcularEstoqueProdutoDeLotes(tx, estoqueDestino.id, produtoDestinoId);
      loteDestinoId = novoLote.id;
      destinoNova = destinoAnterior + qtdDestino;
    } else {
      destinoAnterior = Number(estoqueDestino.quantidade);
      destinoNova = destinoAnterior + qtdDestino;
      await estoqueDepositoRepo.definirQuantidade(tx, tenantId, produtoDestinoId, depositoId, destinoNova);
    }

    const movimentacaoOrigem = await tx.movimentacaoEstoque.create({
      data: {
        tenantId, produtoId: produtoOrigemId, tipo: 'transformacao', quantidade: -qtdOrigem,
        quantidadeAnterior: origemAnterior, quantidadeNova: origemNova,
        origem: 'transformacao', origemId: grupoTransformacao, usuarioId,
        observacao: motivoLimpo, depositoId, loteId: loteOrigemId || null,
      },
    });
    const movimentacaoDestino = await tx.movimentacaoEstoque.create({
      data: {
        tenantId, produtoId: produtoDestinoId, tipo: 'transformacao', quantidade: qtdDestino,
        quantidadeAnterior: destinoAnterior, quantidadeNova: destinoNova,
        origem: 'transformacao', origemId: grupoTransformacao, usuarioId,
        observacao: motivoLimpo, depositoId, loteId: loteDestinoId,
      },
    });

    return { origem: movimentacaoOrigem, destino: movimentacaoDestino };
  });
}

module.exports = { transformarProduto };
