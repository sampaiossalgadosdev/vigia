/**
 * Arquivo: estoqueDeposito.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para Deposito e
 * EstoqueProduto (Fase 2a). Só operações mecânicas — a regra de negócio de
 * bloquear venda quando permiteEstoqueNegativo=false fica em
 * estoqueDeposito.service.js.
 * Todas as funções aceitam `tx` como primeiro parâmetro: pode ser o client
 * Prisma padrão (`prisma`) ou o client de dentro de um `$transaction`, já
 * que as duas interfaces são idênticas — permite reaproveitar estas
 * funções tanto dentro de transações existentes (venda, confirmação de
 * NF-e) quanto fora delas (cancelamento de venda, hoje não-transacional).
 * Utilizado por: VendaService, EstoqueRepository, ProdutoRepository,
 * ProdutoService, ImportacaoService, DepositoService.
 */
const prisma = require('../config/database');

/**
 * Depósito Principal do tenant — cria se ainda não existir (idempotente).
 * Autocura tenants criados antes OU depois desta migração: não depende de
 * o script de backfill já ter rodado.
 */
async function garantirDepositoPrincipal(tx, tenantId) {
  const existente = await tx.deposito.findFirst({ where: { tenantId, principal: true } });
  if (existente) return existente;
  return tx.deposito.create({ data: { tenantId, nome: 'Depósito Principal', principal: true } });
}

async function buscarEstoqueProduto(tx, produtoId, depositoId) {
  return tx.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId, depositoId } } });
}

/** Garante a linha de EstoqueProduto do produto no depósito (cria com quantidade 0 se não existir). */
async function garantirEstoqueProduto(tx, produtoId, depositoId) {
  const existente = await buscarEstoqueProduto(tx, produtoId, depositoId);
  if (existente) return existente;
  return tx.estoqueProduto.create({ data: { produtoId, depositoId, quantidade: 0 } });
}

/** Atalho: linha de EstoqueProduto do produto no Depósito Principal do tenant (ou null se o depósito ainda não existe). */
async function buscarEstoquePrincipal(tx, tenantId, produtoId) {
  const deposito = await tx.deposito.findFirst({ where: { tenantId, principal: true } });
  if (!deposito) return null;
  return buscarEstoqueProduto(tx, produtoId, deposito.id);
}

/**
 * Soma de EstoqueProduto.quantidade do produto em todos os depósitos, e
 * sincroniza Produto.estoqueQtd para bater com essa soma. Função central —
 * todo ponto que altera EstoqueProduto chama isso depois, em vez de
 * duplicar a lógica de soma.
 */
async function recalcularEstoqueAgregado(tx, produtoId) {
  const agregado = await tx.estoqueProduto.aggregate({ where: { produtoId }, _sum: { quantidade: true } });
  const total = agregado._sum.quantidade ?? 0;
  await tx.produto.update({ where: { id: produtoId }, data: { estoqueQtd: total } });
  return total;
}

/** Soma um delta (positivo ou negativo) ao estoque do produto no Depósito Principal do tenant, e recalcula o agregado. */
async function ajustarEstoquePrincipal(tx, tenantId, produtoId, delta) {
  const deposito = await garantirDepositoPrincipal(tx, tenantId);
  const estoque = await garantirEstoqueProduto(tx, produtoId, deposito.id);
  const atualizado = await tx.estoqueProduto.update({
    where: { id: estoque.id },
    data: { quantidade: { increment: delta } },
  });
  await recalcularEstoqueAgregado(tx, produtoId);
  return atualizado;
}

/** Define (set absoluto, não delta) o estoque do produto no Depósito Principal — usado na edição manual do produto/importação. */
async function definirEstoquePrincipal(tx, tenantId, produtoId, quantidade) {
  const deposito = await garantirDepositoPrincipal(tx, tenantId);
  const estoque = await garantirEstoqueProduto(tx, produtoId, deposito.id);
  const atualizado = await tx.estoqueProduto.update({ where: { id: estoque.id }, data: { quantidade } });
  await recalcularEstoqueAgregado(tx, produtoId);
  return atualizado;
}

/**
 * Define (set absoluto, não delta) o estoque do produto em QUALQUER
 * depósito informado — versão genérica de definirEstoquePrincipal (que é
 * fixa no Depósito Principal), usada pelo ajuste manual (Fase 2c), já que
 * o ajuste pode ocorrer em qualquer depósito do tenant.
 */
async function definirQuantidade(tx, produtoId, depositoId, quantidade) {
  const estoque = await garantirEstoqueProduto(tx, produtoId, depositoId);
  const atualizado = await tx.estoqueProduto.update({ where: { id: estoque.id }, data: { quantidade } });
  await recalcularEstoqueAgregado(tx, produtoId);
  return atualizado;
}

/**
 * Linhas de EstoqueProduto de um depósito (produtos ativos), com o produto
 * incluído — usada pra povoar o snapshot do Inventário (Fase 2c). Filtro
 * opcional por categoria (inventário parcial).
 */
async function listarEstoquePorDeposito(depositoId, categoriaId) {
  return prisma.estoqueProduto.findMany({
    where: { depositoId, produto: { ativo: true, ...(categoriaId ? { categoriaId } : {}) } },
    include: { produto: { select: { id: true, nome: true, categoriaId: true, controlaLote: true } } },
  });
}

/** Liga/desliga a permissão de estoque negativo do produto no Depósito Principal. */
async function definirPermiteNegativo(tx, tenantId, produtoId, permite) {
  const deposito = await garantirDepositoPrincipal(tx, tenantId);
  const estoque = await garantirEstoqueProduto(tx, produtoId, deposito.id);
  return tx.estoqueProduto.update({ where: { id: estoque.id }, data: { permiteEstoqueNegativo: permite } });
}

async function listarDepositos(tenantId) {
  return prisma.deposito.findMany({ where: { tenantId, ativo: true }, orderBy: [{ principal: 'desc' }, { nome: 'asc' }] });
}

async function buscarPorNome(tenantId, nome) {
  return prisma.deposito.findFirst({ where: { tenantId, nome } });
}

async function criarDeposito(tenantId, nome) {
  return prisma.deposito.create({ data: { tenantId, nome, principal: false } });
}

async function buscarPorId(tenantId, id) {
  return prisma.deposito.findFirst({ where: { id, tenantId } });
}

/** Renomeia o depósito. Nunca altera `principal` — ver deposito.service.atualizar. */
async function atualizarNome(tenantId, id, nome) {
  return prisma.deposito.update({ where: { id, tenantId }, data: { nome } });
}

/** Soft delete — quem chama já garantiu que não é o depósito principal (ver deposito.service.remover). */
async function desativarDeposito(tenantId, id) {
  return prisma.deposito.update({ where: { id, tenantId }, data: { ativo: false } });
}

module.exports = {
  garantirDepositoPrincipal, buscarEstoqueProduto, garantirEstoqueProduto, buscarEstoquePrincipal,
  recalcularEstoqueAgregado, ajustarEstoquePrincipal, definirEstoquePrincipal, definirPermiteNegativo,
  listarDepositos, buscarPorNome, criarDeposito, buscarPorId, atualizarNome, desativarDeposito,
  definirQuantidade, listarEstoquePorDeposito,
};
