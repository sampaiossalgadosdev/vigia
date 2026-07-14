/**
 * Arquivo: pdvSnapshot.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para montar o snapshot
 * de leitura do PDV (Fase 3a — schema SQLite local do PDV, só leitura).
 * Utilizado por: PdvSnapshotService.
 */
const prisma = require('../config/database');

/** Produtos do tenant (mesmo padrão sem filtro de ativo do produtoRepo.sync). */
async function listarProdutos(tenantId) {
  return prisma.produto.findMany({
    where: { tenantId },
    select: {
      id: true,
      nome: true,
      ean: true,
      plu: true,
      preco: true,
      controlaLote: true,
      categoriaId: true,
      updatedAt: true,
    },
  });
}

/** Linhas de EstoqueProduto de um depósito, com os lotes ativos incluídos. */
async function listarEstoqueComLotes(depositoId) {
  return prisma.estoqueProduto.findMany({
    where: { depositoId },
    select: {
      produtoId: true,
      depositoId: true,
      quantidade: true,
      permiteEstoqueNegativo: true,
      lotes: {
        where: { ativo: true },
        select: { id: true, quantidade: true, dataValidade: true },
      },
    },
  });
}

module.exports = { listarProdutos, listarEstoqueComLotes };
