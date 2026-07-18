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
      codigoReferencia: true,
      unidade: true,
      ativo: true,
      preco: true,
      controlaLote: true,
      categoriaId: true,
      updatedAt: true,
      ncm: true,
      cfop: true,
      cstIbsCbs: true,
      cClassTrib: true,
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

/**
 * Dados fiscais do tenant pro PDV cachear localmente (pré-requisito pra
 * montar XML de NFC-e em contingência quando o backend estiver fora do ar).
 * Select EXPLÍCITO de propósito — nunca inclui certificadoPfx/
 * certificadoSenha/csc* (nada disso vai pro PDV; a chave privada só existe
 * no app ASSINATURA, protegida por safeStorage).
 */
async function buscarDadosFiscais(tenantId) {
  return prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      cnpj: true, nome: true, uf: true, regimeTributario: true, ambienteFiscal: true,
      inscricaoEstadual: true, logradouro: true, numero: true, complemento: true,
      bairro: true, municipio: true, codigoMunicipioIbge: true, cep: true,
    },
  });
}

module.exports = { listarProdutos, listarEstoqueComLotes, buscarDadosFiscais };
