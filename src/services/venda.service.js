const prisma = require('../config/database');
const vendaRepo = require('../repositories/venda.repository');
const produtoRepo = require('../repositories/produto.repository');
const promocaoRepo = require('../repositories/promocao.repository');
const caixaRepo = require('../repositories/caixa.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const estoqueDepositoService = require('../services/estoqueDeposito.service');
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
    },
    itens: [],
    pagamentos: [],
  };

  const itens = body.itens || [];
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
    const subtotal = precoFinal * qtd;
    payload.itens.push({
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
      const produto = await tx.produto.findUnique({ where: { id: item.produtoId } });
      const qtd = Number(item.quantidade);
      // Decrementa no Depósito Principal (Fase 2a) — bloqueia com AppError
      // (e a transação inteira dá rollback) se permiteEstoqueNegativo=false
      // e a venda deixaria o estoque negativo; senão, preserva o
      // comportamento atual (permite e sinaliza pro log de auditoria abaixo).
      const resultado = await estoqueDepositoService.decrementarComRegra(tx, tenantId, produto.id, produto.nome, qtd);
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
      if (resultado.ficouNegativo) {
        await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'estoque_negativo', entidade: 'Produto', entidadeId: produto.id, depois: { estoque: resultado.estoqueAnterior, solicitado: qtd }, ip });
      }
    }

    await tx.caixa.update({
      where: { id: caixaAberto.id },
      data: {
        totalVendas: Number(caixaAberto.totalVendas) + Number(criada.total),
        totalDinheiro: Number(caixaAberto.totalDinheiro) + Number(payload.pagamentos.filter((p) => p.forma === 'dinheiro').reduce((s, p) => s + Number(p.valor), 0)),
        totalCartao: Number(caixaAberto.totalCartao) + Number(payload.pagamentos.filter((p) => p.forma === 'credito' || p.forma === 'debito').reduce((s, p) => s + Number(p.valor), 0)),
        totalPix: Number(caixaAberto.totalPix) + Number(payload.pagamentos.filter((p) => p.forma === 'pix').reduce((s, p) => s + Number(p.valor), 0)),
      },
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
    await prisma.caixa.update({ where: { id: caixaAberto.id }, data: { totalVendas: Math.max(0, Number(caixaAberto.totalVendas) - Number(venda.total)) } });
  }
  await vendaRepo.atualizarStatus(tenantId, id, { status: 'cancelada', canceladoEm: new Date(), canceladoPor: usuario.id, motivoCancelamento: motivo });
  for (const item of venda.itens) {
    const produto = await produtoRepo.buscarPorId(tenantId, item.produtoId);
    await estoqueDepositoRepo.ajustarEstoquePrincipal(prisma, tenantId, produto.id, Number(item.quantidade));
    await prisma.movimentacaoEstoque.create({ data: { tenantId, produtoId: produto.id, tipo: 'devolucao', quantidade: Number(item.quantidade), custoUnit: Number(item.custoUnitario), origem: 'devolucao', origemId: venda.id, usuarioId: usuario.id } });
  }
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'cancelar', entidade: 'Venda', entidadeId: id, depois: { motivo }, ip });
  return { cancelada: true };
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

module.exports = { listar, detalhar, registrar, cancelar, sync };