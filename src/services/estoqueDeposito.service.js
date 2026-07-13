/**
 * Arquivo: estoqueDeposito.service.js
 * Responsabilidade: Regra de negócio de estoque por depósito (Fase 2a) —
 * hoje só a checagem de permiteEstoqueNegativo ao decrementar (venda).
 * Incrementar (NF-e, cancelamento de venda) nunca corre risco de ficar
 * negativo, então não passa por regra nenhuma, só pela camada mecânica do
 * repository.
 * Utilizado por: VendaService.
 * Depende de: EstoqueDepositoRepository.
 */
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const { AppError } = require('../utils/response');

/**
 * Decrementa o estoque do produto no Depósito Principal (ex: item de
 * venda). Se permiteEstoqueNegativo=false e o resultado ficaria negativo,
 * BLOQUEIA (lança AppError, nada é alterado — quem chama isso dentro de
 * uma $transaction tem o rollback automático do Prisma). Se
 * permiteEstoqueNegativo=true (padrão, preserva o comportamento atual),
 * permite e devolve ficouNegativo=true pra quem chama decidir se registra
 * o log de auditoria de sempre.
 */
// tenantId aqui não re-verifica produtoId contra o tenant (isso já
// aconteceu na query que o chamador fez pra obter o produto, ver
// venda.service.registrar) — só é usado pra achar/criar o Depósito
// Principal certo.
async function decrementarComRegra(tx, tenantId, produtoId, nomeProduto, quantidade) {
  const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(tx, tenantId);
  const estoqueAtual = await estoqueDepositoRepo.garantirEstoqueProduto(tx, produtoId, deposito.id);
  const qtd = Number(quantidade);
  const anterior = Number(estoqueAtual.quantidade);
  const resultante = anterior - qtd;

  if (!estoqueAtual.permiteEstoqueNegativo && resultante < 0)
    throw new AppError(`Estoque insuficiente para ${nomeProduto}, venda bloqueada`, 422);

  await tx.estoqueProduto.update({ where: { id: estoqueAtual.id }, data: { quantidade: resultante } });
  await estoqueDepositoRepo.recalcularEstoqueAgregado(tx, produtoId);

  return { estoqueAnterior: anterior, estoqueAtual: resultante, ficouNegativo: resultante < 0 };
}

module.exports = { decrementarComRegra };
