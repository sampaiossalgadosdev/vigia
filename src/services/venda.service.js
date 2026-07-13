const crypto = require('crypto');
const prisma = require('../config/database');
const vendaRepo = require('../repositories/venda.repository');
const produtoRepo = require('../repositories/produto.repository');
const promocaoRepo = require('../repositories/promocao.repository');
const caixaRepo = require('../repositories/caixa.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const estoqueDepositoService = require('../services/estoqueDeposito.service');
const loteService = require('../services/lote.service');
const loteRepo = require('../repositories/lote.repository');
const { configuracaoFiscalCompleta } = require('../services/configuracaoFiscal.service');
const logger = require('../logs/logger');
const { AppError, paginado } = require('../utils/response');

function normalizarPreco(preco, desconto, tipo) {
  if (tipo === 'percentual') return Number(preco) * (1 - Number(desconto) / 100);
  if (tipo === 'valor_fixo') return Math.max(0, Number(preco) - Number(desconto));
  return Number(preco);
}

async function listar(tenantId, query, pag) {
  const { items, total } = await vendaRepo.listar(tenantId, query, { skip: pag.skip, take: pag.limit });
  return paginado(items, total, pag.page, pag.limit);
}

async function detalhar(tenantId, id) {
  const venda = await vendaRepo.buscarPorId(tenantId, id);
  if (!venda) throw new AppError('Venda não encontrada', 404);
  return venda;
}

async function registrar(tenantId, body, usuario, ip) {
  const caixaAberto = await caixaRepo.buscarAberto(tenantId);
  if (!caixaAberto) throw new AppError('Abra um caixa antes de registrar vendas', 422);

  // Fila assíncrona de emissão (complemento Fase 1c/3): só marca o campo
  // aqui — NENHUMA chamada à SEFAZ acontece no fluxo de venda. Isso é só
  // um SELECT no Tenant (configuracaoFiscalCompleta), sem rede, então não
  // atrasa a resposta ao PDV. Quem de fato emite é o worker separado
  // (filaEmissaoNfce.service.processarFilaEmissao), rodando à parte.
  const { completa: fiscalCompleta } = await configuracaoFiscalCompleta(tenantId);

  const payload = {
    venda: {
      tenantId,
      operadorId: usuario.id,
      subtotal: 0,
      total: 0,
      desconto: Number(body.desconto || 0),
      troco: body.troco || 0,
      cpfConsumidor: body.cpfConsumidor || null,
      chaveNfce: body.localId || body.chaveNfce || null,
      statusEmissaoFiscal: fiscalCompleta ? 'pendente' : 'nao_aplicavel',
    },
    itens: [],
    pagamentos: [],
  };

  const itens = body.itens || [];
  if (itens.length === 0) throw new AppError('A venda precisa ter ao menos um item', 422);
  for (const item of itens) {
    const produto = await produtoRepo.buscarPorId(tenantId, item.produtoId);
    if (!produto || !produto.ativo) throw new AppError('Produto não encontrado', 404);

    const promocao = await promocaoRepo.buscarAtivaPorProduto(tenantId, produto.id);
    const precoBase = Number(produto.preco);
    let precoFinal = precoBase;
    let promocaoId = null;
    if (promocao && new Date(promocao.dataFim) >= new Date()) {
      precoFinal = normalizarPreco(precoBase, promocao.desconto, promocao.tipo);
      promocaoId = promocao.id;
    }

    const qtd = Number(item.quantidade);
    if (!(qtd > 0)) throw new AppError(`Quantidade inválida para o produto ${produto.nome}`, 422);
    const subtotal = precoFinal * qtd;
    payload.itens.push({
      // Gerado no client (não deixado pro default do Prisma) porque
      // createMany não retorna os ids criados, e o rastreio de lote
      // (VendaItemLote) precisa do vendaItemId antes de continuar.
      id: crypto.randomUUID(),
      produtoId: produto.id,
      quantidade: qtd,
      precoUnitario: precoFinal,
      custoUnitario: Number(produto.custoMedio || 0),
      desconto: 0,
      subtotal,
      total: subtotal,
      promocaoId,
    });
    payload.venda.subtotal += subtotal;
    payload.venda.total += subtotal;
  }

  if (payload.venda.desconto < 0) throw new AppError('Desconto não pode ser negativo', 422);
  if (payload.venda.desconto > payload.venda.subtotal) throw new AppError('Desconto não pode ser maior que o subtotal da venda', 422);

  const totalPagamentos = (body.pagamentos || []).reduce((sum, p) => sum + Number(p.valor), 0);
  payload.venda.total = Math.max(0, payload.venda.total - Number(payload.venda.desconto));
  payload.pagamentos = (body.pagamentos || []).map((p) => ({ forma: p.forma, valor: Number(p.valor) }));
  payload.venda.troco = Math.max(0, totalPagamentos - payload.venda.total);

  const venda = await prisma.$transaction(async (tx) => {
    const criada = await tx.venda.create({ data: payload.venda });
    const itensData = payload.itens.map((item) => ({ ...item, vendaId: criada.id }));
    await tx.vendaItem.createMany({ data: itensData });
    await tx.vendaPagamento.createMany({ data: payload.pagamentos.map((p) => ({ ...p, vendaId: criada.id })) });

    for (const item of itensData) {
      // Mesmo tenantId já usado pra buscar este produto lá em cima, agora
      // aplicado nesta query (que já ia acontecer de qualquer forma) — sem
      // custo extra de round-trip, garante que o decremento de estoque
      // abaixo nunca mexe no EstoqueProduto de um produto de outro tenant.
      const produto = await tx.produto.findFirst({ where: { id: item.produtoId, tenantId } });
      if (!produto) throw new AppError('Produto não encontrado', 404);
      const qtd = Number(item.quantidade);
      // Fase 2b: produto com controlaLote consome FIFO (lote mais antigo
      // primeiro) e bloqueia se esbarrar em lote vencido — nunca decrementa
      // direto o agregado. Produto sem controlaLote: comportamento EXATO da
      // Fase 2a (decremento direto + permiteEstoqueNegativo).
      let ficouNegativo = false;
      let estoqueAnterior = null;
      if (produto.controlaLote) {
        // Rastreia de qual(is) lote(s) este item consumiu, pra devolver
        // certo se a venda for cancelada depois (ver cancelar() abaixo).
        const consumos = await loteService.consumirVendaFifo(tx, tenantId, produto, qtd);
        for (const consumo of consumos)
          await loteRepo.criarConsumo(tx, item.id, consumo.loteId, consumo.quantidade);
      } else {
        const resultado = await estoqueDepositoService.decrementarComRegra(tx, tenantId, produto.id, produto.nome, qtd);
        ficouNegativo = resultado.ficouNegativo;
        estoqueAnterior = resultado.estoqueAnterior;
      }
      await tx.movimentacaoEstoque.create({
        data: {
          tenantId,
          produtoId: produto.id,
          tipo: 'saida',
          quantidade: qtd,
          custoUnit: Number(item.custoUnitario || 0),
          origem: 'venda',
          origemId: criada.id,
          usuarioId: usuario.id,
        },
      });
      if (ficouNegativo) {
        await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'estoque_negativo', entidade: 'Produto', entidadeId: produto.id, depois: { estoque: estoqueAnterior, solicitado: qtd }, ip });
      }
    }

    await caixaRepo.atualizar(tx, tenantId, caixaAberto.id, {
      totalVendas: Number(caixaAberto.totalVendas) + Number(criada.total),
      totalDinheiro: Number(caixaAberto.totalDinheiro) + Number(payload.pagamentos.filter((p) => p.forma === 'dinheiro').reduce((s, p) => s + Number(p.valor), 0)),
      totalCartao: Number(caixaAberto.totalCartao) + Number(payload.pagamentos.filter((p) => p.forma === 'credito' || p.forma === 'debito').reduce((s, p) => s + Number(p.valor), 0)),
      totalPix: Number(caixaAberto.totalPix) + Number(payload.pagamentos.filter((p) => p.forma === 'pix').reduce((s, p) => s + Number(p.valor), 0)),
    });
    return criada;
  });

  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'Venda', entidadeId: venda.id, depois: { total: String(venda.total) }, ip });
  return venda;
}

async function cancelar(tenantId, id, usuario, motivo, ip) {
  const venda = await vendaRepo.buscarPorId(tenantId, id);
  if (!venda) throw new AppError('Venda não encontrada', 404);
  if (venda.status === 'cancelada') throw new AppError('Venda já cancelada', 409);
  const caixaAberto = await caixaRepo.buscarAberto(tenantId);
  if (caixaAberto) {
    await caixaRepo.atualizar(prisma, tenantId, caixaAberto.id, { totalVendas: Math.max(0, Number(caixaAberto.totalVendas) - Number(venda.total)) });
  }
  await vendaRepo.atualizarStatus(tenantId, id, { status: 'cancelada', canceladoEm: new Date(), canceladoPor: usuario.id, motivoCancelamento: motivo });
  for (const item of venda.itens) {
    const produto = await produtoRepo.buscarPorId(tenantId, item.produtoId);
    const consumos = await loteRepo.listarConsumosPorItem(prisma, item.id);
    if (consumos.length > 0) {
      // Devolve exatamente pro(s) lote(s) de origem — preserva a
      // invariante "EstoqueProduto.quantidade = soma dos Lote ativos".
      const estoqueProdutoIds = new Set();
      for (const consumo of consumos) {
        const lote = await loteRepo.devolverAoLote(prisma, consumo.loteId, Number(consumo.quantidade));
        estoqueProdutoIds.add(lote.estoqueProdutoId);
      }
      for (const estoqueProdutoId of estoqueProdutoIds)
        await loteRepo.recalcularEstoqueProdutoDeLotes(prisma, estoqueProdutoId, produto.id);
    } else {
      if (produto.controlaLote)
        logger.warn('Cancelamento de venda sem rastreio de lote — devolução aplicada só ao agregado', { tenantId, vendaId: id, vendaItemId: item.id, produtoId: produto.id });
      await estoqueDepositoRepo.ajustarEstoquePrincipal(prisma, tenantId, produto.id, Number(item.quantidade));
    }
    await prisma.movimentacaoEstoque.create({ data: { tenantId, produtoId: produto.id, tipo: 'devolucao', quantidade: Number(item.quantidade), custoUnit: Number(item.custoUnitario), origem: 'devolucao', origemId: venda.id, usuarioId: usuario.id } });
  }
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'cancelar', entidade: 'Venda', entidadeId: id, depois: { motivo }, ip });
  return { cancelada: true };
}

/** XML da NFC-e salvo na venda (Fase 1c complemento) — inclui rejeitadas, que também gravam o XML tentado. */
async function buscarXml(tenantId, id) {
  const venda = await vendaRepo.buscarXml(tenantId, id);
  if (!venda) throw new AppError('Venda não encontrada', 404);
  if (!venda.xmlNfce) throw new AppError('Esta venda não tem XML de NFC-e salvo — nunca foi emitida', 404);
  return { vendaId: venda.id, chaveNfce: venda.chaveNfce, xml: venda.xmlNfce };
}

async function sync(tenantId, vendas) {
  const resultados = [];
  for (const venda of vendas || []) {
    const existente = await vendaRepo.buscarPorIdLocal(tenantId, venda.localId);
    if (existente) { resultados.push({ localId: venda.localId, status: 'ok', mensagem: 'Ignorada por duplicidade' }); continue; }
    try {
      await registrar(tenantId, venda, { id: venda.operadorId || 'pdv' }, 'sync');
      resultados.push({ localId: venda.localId, status: 'ok', mensagem: 'Sincronizada' });
    } catch (error) {
      resultados.push({ localId: venda.localId, status: 'erro', mensagem: error.message });
    }
  }
  return resultados;
}

module.exports = { listar, detalhar, registrar, cancelar, sync, buscarXml };