/**
 * Arquivo: pdvSnapshot.service.js
 * Responsabilidade: Montar o snapshot completo (não incremental) que o PDV
 * baixa para popular seu SQLite local (Fase 3a — só leitura: catálogo,
 * preço e estoque/lote; nenhuma lógica de venda offline aqui, isso é 3b).
 * Assume Depósito Principal do tenant — o sistema ainda opera
 * single-depósito (venda, lote e estoque já resolvem tudo para o principal
 * hoje); não há hoje um conceito de "terminal vinculado a um depósito"
 * específico. Decisão de multi-loja/multi-depósito por terminal fica
 * pendente para uma fase futura — ver decisão registrada na investigação
 * da Fase 3a.
 * Utilizado por: rota GET /api/pdv/snapshot.
 */
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const pdvSnapshotRepo = require('../repositories/pdvSnapshot.repository');
const prisma = require('../config/database');

async function montar(tenantId) {
  // Assume Depósito Principal do tenant — ver premissa documentada acima.
  const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenantId);

  const [produtos, estoques] = await Promise.all([
    pdvSnapshotRepo.listarProdutos(tenantId),
    pdvSnapshotRepo.listarEstoqueComLotes(deposito.id),
  ]);

  const estoquePorProduto = new Map(estoques.map((e) => [e.produtoId, e]));

  const produtosSnapshot = produtos.map((p) => {
    const estoque = estoquePorProduto.get(p.id);
    return {
      id: p.id,
      nome: p.nome,
      ean: p.ean,
      plu: p.plu,
      codigoReferencia: p.codigoReferencia,
      unidade: p.unidade,
      ativo: p.ativo,
      precoVenda: Number(p.preco),
      controlaLote: p.controlaLote,
      permiteEstoqueNegativo: estoque ? estoque.permiteEstoqueNegativo : true,
      categoriaId: p.categoriaId,
      origemVersao: p.updatedAt.toISOString(),
    };
  });

  const geradoEm = new Date().toISOString();

  const estoqueSnapshot = estoques.map((e) => ({
    produtoId: e.produtoId,
    depositoId: e.depositoId,
    quantidade: Number(e.quantidade),
    atualizadoEm: geradoEm,
  }));

  const lotes = estoques.flatMap((e) =>
    e.lotes.map((lote) => ({
      id: lote.id,
      produtoId: e.produtoId,
      depositoId: e.depositoId,
      quantidade: Number(lote.quantidade),
      dataValidade: lote.dataValidade.toISOString(),
      atualizadoEm: geradoEm,
    }))
  );

  return { geradoEm, depositoId: deposito.id, produtos: produtosSnapshot, estoque: estoqueSnapshot, lotes };
}

module.exports = { montar };
