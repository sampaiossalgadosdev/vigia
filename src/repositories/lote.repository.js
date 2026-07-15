/**
 * Arquivo: lote.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para Lote (Fase 2b —
 * controle de lote/validade por produto, opcional via Produto.controlaLote).
 * Só operações mecânicas — a regra de negócio de FIFO/bloqueio de vencido
 * fica em lote.service.js.
 * Todas as funções que recebem `tx` aceitam tanto o client Prisma padrão
 * quanto o client de dentro de um `$transaction`, mesmo padrão de
 * estoqueDeposito.repository.js.
 * Utilizado por: LoteService, EstoqueRepository.
 */
const prisma = require('../config/database');
const estoqueDepositoRepo = require('./estoqueDeposito.repository');

/** Lotes ativos do EstoqueProduto, mais antigo (menor dataValidade) primeiro — ordem de consumo FIFO. */
async function listarAtivosOrdenados(tx, estoqueProdutoId) {
  return tx.lote.findMany({
    where: { estoqueProdutoId, ativo: true },
    orderBy: { dataValidade: 'asc' },
  });
}

/**
 * Lotes ativos do EstoqueProduto, com FOR UPDATE adquirido em ordem de id
 * ASCENDENTE — não de dataValidade. É essa ordem (sempre a mesma,
 * independente de qual produto/carrinho chegou primeiro) que evita
 * deadlock entre transações concorrentes que tocam os mesmos lotes em
 * sequências diferentes (ex: dois carrinhos que consomem os mesmos 2
 * lotes, mas com os itens em ordem diferente no carrinho — a trava sempre
 * é pedida na mesma sequência por id, nunca há espera circular).
 * A leitura de quantidade (Number(lote.quantidade), feita por quem chama
 * em lote.service.consumirVendaFifo) só acontece DEPOIS que esta função
 * retorna — ou seja, depois da trava já adquirida em todos os lotes.
 * Devolve reordenado por dataValidade ASC (ordem de CONSUMO FIFO, que é
 * diferente da ordem de TRAVA acima) — a regra de negócio de FIFO não
 * muda, só a ordem de aquisição da trava.
 * Só faz sentido dentro de uma transação (`tx`) — FOR UPDATE fora de uma
 * transação libera a trava no fim do próprio SELECT, sem propósito aqui.
 */
async function listarAtivosParaConsumo(tx, estoqueProdutoId) {
  const lotes = await tx.$queryRaw`
    SELECT * FROM "Lote"
    WHERE "estoqueProdutoId" = ${estoqueProdutoId} AND ativo = true
    ORDER BY id ASC
    FOR UPDATE
  `;
  return lotes.slice().sort((a, b) => new Date(a.dataValidade) - new Date(b.dataValidade));
}

/** Cria uma linha de Lote nova para uma entrada de estoque (NF-e). Nunca mescla com lote existente. */
async function criar(tx, estoqueProdutoId, { numeroLote, dataValidade, quantidade }) {
  return tx.lote.create({
    data: { estoqueProdutoId, numeroLote: numeroLote || null, dataValidade, quantidade },
  });
}

/** Atualiza a quantidade consumida de um lote (venda/FIFO) e desativa quando chega a zero. */
async function atualizarQuantidade(tx, loteId, quantidade) {
  return tx.lote.update({ where: { id: loteId }, data: { quantidade, ativo: quantidade > 0 } });
}

async function somarAtivos(tx, estoqueProdutoId) {
  const agregado = await tx.lote.aggregate({ where: { estoqueProdutoId, ativo: true }, _sum: { quantidade: true } });
  return agregado._sum.quantidade ?? 0;
}

/**
 * Recalcula EstoqueProduto.quantidade como soma dos Lote ativos daquele
 * EstoqueProduto, e sincroniza Produto.estoqueQtd (agregado de todos os
 * depósitos) reaproveitando estoqueDeposito.repository.recalcularEstoqueAgregado.
 */
async function recalcularEstoqueProdutoDeLotes(tx, estoqueProdutoId, produtoId) {
  const total = await somarAtivos(tx, estoqueProdutoId);
  await tx.estoqueProduto.update({ where: { id: estoqueProdutoId }, data: { quantidade: total } });
  await estoqueDepositoRepo.recalcularEstoqueAgregado(tx, produtoId);
  return total;
}

/** Registra que um VendaItem consumiu `quantidade` de um Lote específico (rastreio pro cancelamento). */
async function criarConsumo(tx, vendaItemId, loteId, quantidade) {
  return tx.vendaItemLote.create({ data: { vendaItemId, loteId, quantidade } });
}

/** VendaItemLote de um VendaItem — vazio quando a venda é anterior a este rastreio, ou o produto não controla lote. */
async function listarConsumosPorItem(tx, vendaItemId) {
  return tx.vendaItemLote.findMany({ where: { vendaItemId } });
}

/**
 * Devolve `quantidade` ao Lote de origem (cancelamento de venda) e reativa
 * o lote incondicionalmente — mesmo que a dataValidade já tenha passado, o
 * produto voltou fisicamente pro estoque e deve aparecer nos alertas de
 * vencimento de novo, não sumir por estar com ativo=false.
 */
async function devolverAoLote(tx, loteId, quantidade) {
  return tx.lote.update({ where: { id: loteId }, data: { quantidade: { increment: quantidade }, ativo: true } });
}

async function buscarPorId(tx, loteId) {
  return tx.lote.findUnique({ where: { id: loteId } });
}

/**
 * Lote do EstoqueProduto de destino com o mesmo numeroLote+dataValidade —
 * usado na transferência entre depósitos (Fase 2d) pra decidir se
 * incrementa um lote já existente em vez de duplicar a mesma identidade.
 */
async function buscarPorNumeroEValidade(tx, estoqueProdutoId, numeroLote, dataValidade) {
  return tx.lote.findFirst({ where: { estoqueProdutoId, numeroLote: numeroLote || null, dataValidade } });
}

/** Lotes ativos do tenant com dataValidade até `limite` (para alertas de vencimento e promoção relâmpago). */
async function listarAteData(tenantId, limite) {
  return prisma.lote.findMany({
    where: {
      ativo: true,
      dataValidade: { lte: limite },
      estoqueProduto: { produto: { tenantId } },
    },
    include: {
      estoqueProduto: { include: { produto: { select: { id: true, nome: true, ean: true, unidade: true } } } },
    },
    orderBy: { dataValidade: 'asc' },
  });
}

module.exports = {
  listarAtivosOrdenados, listarAtivosParaConsumo, criar, atualizarQuantidade, somarAtivos,
  recalcularEstoqueProdutoDeLotes, listarAteData,
  criarConsumo, listarConsumosPorItem, devolverAoLote, buscarPorId, buscarPorNumeroEValidade,
};
