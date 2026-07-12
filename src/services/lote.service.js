/**
 * Arquivo: lote.service.js
 * Responsabilidade: Regra de negócio de lote/validade (Fase 2b) — consumo
 * FIFO na venda com bloqueio de lote vencido, exigência de lote+validade na
 * entrada de estoque, alertas de vencimento e geração de promoção relâmpago
 * automática para produtos com lote perto de vencer.
 * Só entra em jogo para produtos com controlaLote=true — produtos com
 * controlaLote=false nunca passam por aqui (ver venda.service.js e
 * estoque.repository.js).
 * Utilizado por: VendaService, EstoqueRepository, EstoqueService.
 * Depende de: LoteRepository, EstoqueDepositoRepository, PromocaoRepository.
 */
const prisma = require('../config/database');
const loteRepo = require('../repositories/lote.repository');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const promocaoRepo = require('../repositories/promocao.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const pdvGateway = require('../ws/pdvGateway');
const { AppError } = require('../utils/response');

const UM_DIA_MS = 24 * 60 * 60 * 1000;
// Desconto padrão da promoção relâmpago automática — constante fácil de
// ajustar; não precisa ser dinâmico nesta fase.
const DESCONTO_RELAMPAGO_PERCENTUAL = 20;

function dataBr(data) {
  return new Date(data).toLocaleDateString('pt-BR');
}

/**
 * Consome a quantidade vendida dos lotes ativos do produto no Depósito
 * Principal, do mais antigo (menor dataValidade) pro mais novo. Bloqueia a
 * venda inteira (sem alterar nada) se o lote mais antigo em que esbarrar
 * durante o consumo já estiver vencido — nunca pula pro próximo lote mais
 * novo automaticamente, pois isso esconderia o lote vencido em vez de
 * forçar giro/descarte dele.
 * Retorna [{ loteId, quantidade }] com o que foi de fato consumido de cada
 * lote — quem chama usa isso pra gravar o rastreio em VendaItemLote (só
 * assim o cancelamento sabe pra qual lote devolver depois).
 */
async function consumirVendaFifo(tx, tenantId, produto, quantidadeVendida) {
  const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(tx, tenantId);
  const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(tx, produto.id, deposito.id);
  const lotes = await loteRepo.listarAtivosOrdenados(tx, estoqueProduto.id);

  const agora = new Date();
  let restante = Number(quantidadeVendida);
  const consumos = [];

  for (const lote of lotes) {
    if (restante <= 0) break;
    if (new Date(lote.dataValidade) < agora)
      throw new AppError(`Produto ${produto.nome} possui lote vencido em ${dataBr(lote.dataValidade)} — venda bloqueada`, 422);

    const disponivel = Number(lote.quantidade);
    const consumido = Math.min(restante, disponivel);
    await loteRepo.atualizarQuantidade(tx, lote.id, disponivel - consumido);
    consumos.push({ loteId: lote.id, quantidade: consumido });
    restante -= consumido;
  }

  if (restante > 0)
    throw new AppError(`Estoque em lote insuficiente para ${produto.nome}, venda bloqueada`, 422);

  await loteRepo.recalcularEstoqueProdutoDeLotes(tx, estoqueProduto.id, produto.id);
  return consumos;
}

/**
 * Registra uma entrada de estoque em um novo Lote (NF-e confirmada ou item
 * vinculado com entrada aplicada). Exige numeroLote/dataValidade — quem
 * chama já deve ter validado a presença desses dados antes (ver
 * EstoqueService.confirmarNfe / vincularItem).
 */
async function registrarEntrada(tx, tenantId, produtoId, quantidade, { numeroLote, dataValidade }) {
  const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(tx, tenantId);
  const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(tx, produtoId, deposito.id);
  await loteRepo.criar(tx, estoqueProduto.id, { numeroLote, dataValidade: new Date(dataValidade), quantidade });
  await loteRepo.recalcularEstoqueProdutoDeLotes(tx, estoqueProduto.id, produtoId);
}

function urgencia(dataValidade, agora) {
  const diffDias = (new Date(dataValidade).getTime() - agora.getTime()) / UM_DIA_MS;
  if (diffDias < 0) return 'vencido';
  if (diffDias <= 3) return 'critico';
  return 'atencao';
}

/** Lotes ativos vencidos ou vencendo dentro de `dias` (default 7), agrupados por urgência. */
async function alertasValidade(tenantId, dias) {
  const janela = Number(dias) > 0 ? Number(dias) : 7;
  const agora = new Date();
  const limite = new Date(agora.getTime() + janela * UM_DIA_MS);
  const lotes = await loteRepo.listarAteData(tenantId, limite);

  const grupos = { vencido: [], critico: [], atencao: [] };
  for (const lote of lotes) {
    const item = {
      loteId: lote.id,
      produtoId: lote.estoqueProduto.produto.id,
      produtoNome: lote.estoqueProduto.produto.nome,
      unidade: lote.estoqueProduto.produto.unidade,
      numeroLote: lote.numeroLote,
      dataValidade: lote.dataValidade,
      quantidade: lote.quantidade,
    };
    grupos[urgencia(lote.dataValidade, agora)].push(item);
  }
  return grupos;
}

/**
 * Gera automaticamente promoção relâmpago (desconto DESCONTO_RELAMPAGO_PERCENTUAL,
 * vigente até a data de validade) para produtos com lote vencendo dentro de
 * `dias` (default 5) que ainda não venceram e que não têm promoção ativa.
 * Produtos que já têm promoção ativa não são alterados — entram na lista de
 * revisão manual da resposta.
 */
async function gerarPromocoesRelampago(tenantId, usuario, ip, dias) {
  const janela = Number(dias) > 0 ? Number(dias) : 5;
  const agora = new Date();
  const limite = new Date(agora.getTime() + janela * UM_DIA_MS);
  const lotes = await loteRepo.listarAteData(tenantId, limite);

  // Um produto pode ter mais de um lote vencendo na janela — usa a validade
  // mais próxima (mais urgente) como fim de vigência da promoção.
  const candidatos = new Map();
  for (const lote of lotes) {
    if (new Date(lote.dataValidade) < agora) continue; // já vencido: bloqueado na venda, promoção não ajuda
    const produto = lote.estoqueProduto.produto;
    const atual = candidatos.get(produto.id);
    if (!atual || new Date(lote.dataValidade) < new Date(atual.dataValidade))
      candidatos.set(produto.id, { produto, dataValidade: lote.dataValidade });
  }

  const criadas = [];
  const jaTemPromocaoAtiva = [];
  for (const { produto, dataValidade } of candidatos.values()) {
    const existente = await promocaoRepo.buscarAtivaPorProduto(tenantId, produto.id);
    if (existente) {
      jaTemPromocaoAtiva.push({ produtoId: produto.id, produtoNome: produto.nome, promocaoId: existente.id });
      continue;
    }
    const promocao = await promocaoRepo.criar({
      tenantId,
      produtoId: produto.id,
      nome: `Promoção relâmpago · ${produto.nome}`,
      tipo: 'percentual',
      desconto: DESCONTO_RELAMPAGO_PERCENTUAL,
      dataInicio: agora,
      dataFim: new Date(dataValidade),
    });
    await auditoriaRepo.registrar({
      tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'Promocao', entidadeId: promocao.id,
      depois: { nome: promocao.nome, origem: 'lote_vencendo', desconto: String(promocao.desconto) }, ip,
    });
    pdvGateway.notificarSync(tenantId, 'promocoes');
    criadas.push(promocao);
  }

  return { criadas, jaTemPromocaoAtiva };
}

/**
 * Lotes ativos de um produto num depósito específico, mais antigo primeiro
 * — usado pelas telas (ajuste, transferência) pra montar o seletor de lote.
 * Devolve lista vazia se o depósito não existe ou o produto nunca teve
 * estoque ali (não é erro — só não há lote pra escolher).
 */
async function listarLotesAtivosDoDeposito(tenantId, produtoId, depositoId) {
  const deposito = await estoqueDepositoRepo.buscarPorId(tenantId, depositoId);
  if (!deposito) return [];
  const estoqueProduto = await estoqueDepositoRepo.buscarEstoqueProduto(prisma, produtoId, depositoId);
  if (!estoqueProduto) return [];
  return loteRepo.listarAtivosOrdenados(prisma, estoqueProduto.id);
}

module.exports = {
  consumirVendaFifo, registrarEntrada, alertasValidade, gerarPromocoesRelampago, DESCONTO_RELAMPAGO_PERCENTUAL,
  listarLotesAtivosDoDeposito,
};
