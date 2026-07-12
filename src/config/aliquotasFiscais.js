/**
 * Arquivo: aliquotasFiscais.js
 * Responsabilidade: Único lugar com as alíquotas-teste de IBS/CBS da
 * Reforma Tributária (LC 214/2025) e os regimes dispensados da obrigação
 * em 2026. Centralizado de propósito: essas alíquotas SOBEM e SUBSTITUEM
 * as atuais em 2027 (Lucro Presumido/Real) — quando isso mudar, a mudança
 * deve acontecer aqui, não numa busca por todo o código.
 *
 * ATENÇÃO — PENDENTE DE VALIDAÇÃO CONTÁBIL: a leitura de que o Simples
 * Nacional está dispensado em 2026 (só passa a destacar a partir de 2027) e
 * de que a alíquota-teste 2026 é 0,9% CBS + 0,1% IBS é a mais segura
 * disponível hoje (LC 214/2025), mas NÃO é uma certeza jurídica definitiva.
 * Confirme com o contador do cliente antes de operar em produção.
 */
module.exports = {
  ALIQUOTA_TESTE_2026: {
    CBS: 0.009, // 0,9%
    IBS: 0.001, // 0,1%
  },
  REGIMES_DISPENSADOS_2026: ['simples'], // Simples Nacional dispensado em 2026

  // Código de Regime Tributário oficial da NF-e (campo CRT, convenção
  // estável, não é algo que a Reforma muda): 1 = Simples Nacional,
  // 2 = Simples Nacional excesso de sublimite, 3 = Regime Normal — Lucro
  // Presumido e Lucro Real usam ambos o código 3, a distinção entre eles
  // não afeta o CRT.
  MAPA_CRT: {
    simples: 1,
    presumido: 3,
    real: 3,
  },
};
