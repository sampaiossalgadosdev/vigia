/**
 * Arquivo: aliquotasFiscais.js
 * Responsabilidade: Único lugar com as alíquotas-teste de IBS/CBS da
 * Reforma Tributária (LC 214/2025) e os regimes dispensados da obrigação
 * em 2026. Centralizado de propósito: essas alíquotas SOBEM e SUBSTITUEM
 * as atuais em 2027 (Lucro Presumido/Real) — quando isso mudar, a mudança
 * deve acontecer aqui, não numa busca por todo o código.
 *
 * ALÍQUOTA-TESTE 2026 CONFIRMADA (pesquisa externa em 2026-07-17, fontes
 * secundárias que citam o texto literal — não direto no Diário Oficial/
 * Planalto, indisponível no momento): Art. 346, LC 214/2025 — "a CBS será
 * cobrada mediante aplicação da alíquota de 0,9%"; Art. 343, LC 214/2025 —
 * "o IBS será cobrado mediante aplicação da alíquota estadual de 0,1%"
 * (100% estadual em 2026, ver nfceXml.service.js/montarGrupoIbsCbs — o
 * parágrafo único do Art. 343 tira essa arrecadação das repartições
 * normais, não vai pro município). MUDA em 01/01/2027: Art. 344 — o
 * mesmo 0,1% de IBS passa a 0,05% estadual + 0,05% municipal (o total de
 * IBS/CBS aqui, e o rateio no XML, ainda não têm essa transição
 * implementada — nfceXml.service.js já lança erro claro se tentar emitir
 * com data de 2027+ sem isso).
 *
 * ATENÇÃO — AINDA PENDENTE DE VALIDAÇÃO CONTÁBIL: a leitura de que o
 * Simples Nacional está dispensado em 2026 (só passa a destacar a partir
 * de 2027) NÃO foi confirmada contra texto de lei nesta pesquisa — segue
 * sem certeza jurídica definitiva. Confirme com o contador do cliente
 * antes de operar em produção.
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
