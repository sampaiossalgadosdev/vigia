/**
 * Arquivo: estoque.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para Nfe, NfeItem e
 * MovimentacaoEstoque.
 * Utilizado por: EstoqueService.
 * Não contém regra de negócio.
 */
const prisma = require('../config/database');
const estoqueDepositoRepo = require('./estoqueDeposito.repository');

async function buscarNfePorChave(chaveAcesso) {
  return prisma.nfe.findUnique({ where: { chaveAcesso } });
}

async function criarNfe(dados, itens) {
  return prisma.nfe.create({
    data: { ...dados, itens: { create: itens } },
    include: { itens: true, fornecedor: true },
  });
}

async function listarNfes(tenantId, { status, dataInicio, dataFim }, { skip, take }) {
  const where = { tenantId };
  if (status) where.status = status;
  if (dataInicio || dataFim) {
    where.dataEmissao = {};
    if (dataInicio) where.dataEmissao.gte = dataInicio;
    if (dataFim) where.dataEmissao.lte = dataFim;
  }
  const [items, total] = await Promise.all([
    prisma.nfe.findMany({
      where, skip, take,
      orderBy: { criadoEm: 'desc' },
      include: {
        fornecedor: { select: { nome: true, cnpj: true } },
        // Total de itens e quantos ainda aguardam matching de produto.
        _count: { select: { itens: true, } },
        itens: { where: { status: 'pendente' }, select: { id: true } },
      },
    }),
    prisma.nfe.count({ where }),
  ]);
  return {
    items: items.map(({ itens, ...nfe }) => ({ ...nfe, itensPendentes: itens.length })),
    total,
  };
}

async function buscarNfePorId(tenantId, id) {
  return prisma.nfe.findFirst({
    where: { id, tenantId },
    include: {
      fornecedor: true,
      itens: { include: { produto: { select: { id: true, nome: true, ean: true } } }, orderBy: { descricao: 'asc' } },
    },
  });
}

async function buscarItemNfe(nfeId, itemId) {
  return prisma.nfeItem.findFirst({ where: { id: itemId, nfeId } });
}

async function listarItensPendentes(tenantId) {
  return prisma.nfeItem.findMany({
    where: { status: 'pendente', nfe: { tenantId } },
    include: { nfe: { select: { id: true, numeroNfe: true, chaveAcesso: true, status: true, fornecedor: { select: { nome: true } } } } },
    orderBy: { descricao: 'asc' },
  });
}

async function listarMovimentacoes(tenantId, { produtoId, tipo, inicio, fim }, { skip, take }) {
  const where = { tenantId };
  if (produtoId) where.produtoId = produtoId;
  if (tipo) where.tipo = tipo;
  if (inicio || fim) {
    where.criadoEm = {};
    if (inicio) where.criadoEm.gte = new Date(inicio);
    if (fim) where.criadoEm.lte = new Date(fim);
  }
  const [items, total] = await Promise.all([
    prisma.movimentacaoEstoque.findMany({
      where, skip, take,
      orderBy: { criadoEm: 'desc' },
      include: { produto: { select: { nome: true, ean: true, unidade: true } } },
    }),
    prisma.movimentacaoEstoque.count({ where }),
  ]);
  return { items, total };
}

/**
 * Executa a confirmação de entrada de NF-e dentro de uma transação:
 * para cada item ok, atualiza estoque + custo médio ponderado e cria movimentação.
 */
async function confirmarNfeTransacao(nfe, itensAplicaveis, usuarioId) {
  return prisma.$transaction(async (tx) => {
    for (const item of itensAplicaveis) {
      const produto = await tx.produto.findUnique({ where: { id: item.produtoId } });
      const estoqueAtual = Number(produto.estoqueQtd);
      const custoAtual = Number(produto.custoMedio);
      // Fator de conversão unidade da nota → unidade do sistema (matching
      // manual); a quantidade multiplica e o custo unitário divide.
      const fator = Number(item.fatorConversao) > 0 ? Number(item.fatorConversao) : 1;
      const qtd = Number(item.quantidade) * fator;
      const custoNovo = Number(item.valorUnitario) / fator;

      const novoCusto =
        estoqueAtual <= 0
          ? custoNovo
          : (estoqueAtual * custoAtual + qtd * custoNovo) / (estoqueAtual + qtd);

      await tx.produto.update({
        where: { id: produto.id },
        data: { custoMedio: Math.round(novoCusto * 100) / 100 },
      });
      // Fase 2a: quantidade entra pelo Depósito Principal, que já
      // recalcula Produto.estoqueQtd como agregado dos depósitos.
      await estoqueDepositoRepo.ajustarEstoquePrincipal(tx, nfe.tenantId, produto.id, qtd);

      await tx.movimentacaoEstoque.create({
        data: {
          tenantId: nfe.tenantId,
          produtoId: produto.id,
          tipo: 'entrada',
          quantidade: qtd,
          custoUnit: custoNovo,
          origem: 'nfe',
          origemId: nfe.id,
          usuarioId,
        },
      });
    }
    return tx.nfe.update({
      where: { id: nfe.id },
      data: { status: 'confirmada' },
      include: { itens: true },
    });
  });
}

/**
 * Vincula um item pendente a um produto e, se a NF-e já estiver confirmada,
 * aplica a entrada de estoque do item na mesma transação. fatorConversao
 * (unidade da nota → unidade do sistema) multiplica a quantidade e divide o
 * custo unitário; quando não informado (fluxo antigo), assume 1.
 */
async function vincularItemTransacao(nfe, item, produtoId, usuarioId, aplicarEntrada, fatorConversao) {
  const fator = Number(fatorConversao) > 0 ? Number(fatorConversao) : 1;
  return prisma.$transaction(async (tx) => {
    const atualizado = await tx.nfeItem.update({
      where: { id: item.id },
      data: { produtoId, status: 'ok', fatorConversao: fator },
    });
    if (aplicarEntrada) {
      const produto = await tx.produto.findUnique({ where: { id: produtoId } });
      const estoqueAtual = Number(produto.estoqueQtd);
      const qtd = Number(item.quantidade) * fator;
      const custoNovo = Number(item.valorUnitario) / fator;
      const novoCusto =
        estoqueAtual <= 0
          ? custoNovo
          : (estoqueAtual * Number(produto.custoMedio) + qtd * custoNovo) / (estoqueAtual + qtd);
      await tx.produto.update({
        where: { id: produtoId },
        data: { custoMedio: Math.round(novoCusto * 100) / 100 },
      });
      await estoqueDepositoRepo.ajustarEstoquePrincipal(tx, nfe.tenantId, produtoId, qtd);
      await tx.movimentacaoEstoque.create({
        data: {
          tenantId: nfe.tenantId, produtoId, tipo: 'entrada', quantidade: qtd,
          custoUnit: custoNovo, origem: 'nfe', origemId: nfe.id, usuarioId,
        },
      });
    }
    return atualizado;
  });
}

module.exports = {
  buscarNfePorChave, criarNfe, listarNfes, buscarNfePorId, buscarItemNfe,
  listarItensPendentes, listarMovimentacoes, confirmarNfeTransacao, vincularItemTransacao,
};
