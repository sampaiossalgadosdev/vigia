/**
 * Arquivo: tributoFiscal.service.js
 * Responsabilidade: Calcular IBS/CBS por item de venda (Reforma Tributária,
 * Fase 1b) conforme o regime tributário do tenant. Serviço puro — sem
 * Prisma, sem rede — os valores calculados aqui são gravados como
 * snapshot em VendaItem (valorIbs, valorCbs, cstIbsCbsAplicado,
 * cClassTribAplicado) no momento da venda pelo chamador; este service não
 * grava nada sozinho e nunca recalcula a partir do Produto atual depois.
 * Utilizado por: (Fase 1c) VendaService, no momento de registrar a venda.
 * Depende de: config/aliquotasFiscais.
 *
 * IMPORTANTE — o valor de IBS/CBS aqui é só DESTACADO no documento fiscal
 * como informação (compensado com PIS/Cofins em outra apuração, fora deste
 * sistema); ele NÃO é somado ao valor cobrado do cliente. Quem chama esta
 * função continua usando o preço/subtotal/total já praticado — não some
 * valorIbs/valorCbs a nada que o cliente paga.
 *
 * ATENÇÃO — PLACEHOLDERS PENDENTES DE VALIDAÇÃO (ver comentários abaixo):
 * cstIbsCbsAplicado e cClassTribAplicado NÃO são códigos oficiais reais —
 * são marcadores textuais até confirmarmos contra a tabela de Classificação
 * Tributária do Comitê Gestor do IBS/CBS (Notas Técnicas 2025.00x) antes de
 * qualquer operação em produção.
 */
const { ALIQUOTA_TESTE_2026, REGIMES_DISPENSADOS_2026 } = require('../config/aliquotasFiscais');

// PLACEHOLDER — Simples Nacional está dispensado da obrigação em 2026, mas
// o código real de CST/cClassTrib pra indicar isso na tabela oficial do
// Comitê Gestor do IBS ainda precisa ser confirmado. NÃO usar em produção
// sem essa confirmação.
const PLACEHOLDER_SIMPLES_NACIONAL = 'PENDENTE_SIMPLES_NACIONAL';

// PLACEHOLDER — códigos oficiais reais de CST-IBS/CBS e cClassTrib para
// tributação integral (Lucro Presumido/Real) ainda não confirmados contra
// a tabela oficial. NÃO usar em produção sem essa confirmação.
const PLACEHOLDER_TRIBUTACAO_INTEGRAL = 'PENDENTE_TRIBUTACAO_INTEGRAL';

function arredondar(valor) {
  return Math.round(valor * 100) / 100;
}

/**
 * Calcula IBS/CBS de um item de venda. `produto` é recebido para uso
 * futuro (exceções por NCM/monofásico, isenções específicas) — nesta fase
 * de alíquota-teste única, a regra depende só do regime do tenant.
 */
function calcularTributoItem(tenant, produto, valorItem) {
  if (REGIMES_DISPENSADOS_2026.includes(tenant.regimeTributario)) {
    return {
      valorIbs: 0,
      valorCbs: 0,
      cstIbsCbsAplicado: PLACEHOLDER_SIMPLES_NACIONAL,
      cClassTribAplicado: PLACEHOLDER_SIMPLES_NACIONAL,
    };
  }

  return {
    valorIbs: arredondar(valorItem * ALIQUOTA_TESTE_2026.IBS),
    valorCbs: arredondar(valorItem * ALIQUOTA_TESTE_2026.CBS),
    cstIbsCbsAplicado: PLACEHOLDER_TRIBUTACAO_INTEGRAL,
    cClassTribAplicado: PLACEHOLDER_TRIBUTACAO_INTEGRAL,
  };
}

module.exports = { calcularTributoItem };
