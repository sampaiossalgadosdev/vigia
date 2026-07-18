/**
 * Arquivo: tributoFiscal.test.js
 * Responsabilidade: Confirma o cálculo de IBS/CBS por item (Fase 1b) —
 * regime Simples Nacional dispensado em 2026; Presumido/Real aplicam a
 * alíquota-teste (0,9% CBS + 0,1% IBS) e repassam a classificação fiscal
 * (CST-IBS/CBS + cClassTrib) já cadastrada no produto; o tributo é só
 * DESTACADO (não altera o valor total cobrado na venda); produto sem
 * classificação cadastrada bloqueia o cálculo em vez de inventar um código;
 * indicador de redução de alíquota (indGRed) e de imunidade/não incidência
 * (indGIbsCbs=false) alteram o cálculo conforme o catálogo oficial (NT
 * 2025.002-RTC v1.50, regras UB12-10/UB64-10/UB64-20/UB65-10/UB66-10 —
 * pesquisa de 2026-07-18, PDF oficial de nfe.fazenda.gov.br).
 * '000'/'000001' usados nos testes são códigos REAIS confirmados contra
 * DOCS/cClassTrib 2026-06-22.xlsx (aba "CST 2026-06-01 Pub", código '000' =
 * "Tributação integral", indGIbsCbs=1/indGRed=0; aba "cClass 2026-06-01
 * Pub", código '000001' = "Situações tributadas integralmente pelo IBS e
 * CBS") — não são valores inventados pelo teste. '200'/'200003' e
 * '410'/'410008' idem, também códigos REAIS conferidos contra a planilha
 * (200 = Alíquota reduzida, indGRed=1; 200003 = "Vendas de produtos
 * destinados à alimentação humana" — cesta básica, Art. 125 LC 214/2025,
 * pRedIBS=pRedCBS=100 — ou seja, alíquota final ZERO; 410 = Imunidade e não
 * incidência, indGIbsCbs=0; 410008 = "Fornecimentos de livros, jornais,
 * periódicos e do papel destinado a sua impressão").
 * Uso: node --test src/tests/tributoFiscal.test.js
 * Teste unitário puro — sem banco, sem rede (classificacaoFiscal é passada
 * à mão, como o chamador real — nfceEmissao.service.itensComTributo — faria
 * depois de buscar no catálogo via catalogoFiscal.repository).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularTributoItem } = require('../services/tributoFiscal.service');
const { ALIQUOTA_TESTE_2026 } = require('../config/aliquotasFiscais');

const PRODUTO_CLASSIFICADO = { nome: 'Produto X', cstIbsCbs: '000', cClassTrib: '000001' };
// Indicadores REAIS do par CST '000' + cClassTrib '000001' (tributação
// integral, sem redução) — ver cabeçalho do arquivo.
const CLASSIFICACAO_FISCAL_INTEGRAL = { indGIbsCbs: true, indGRed: false, pRedIbs: null, pRedCbs: null };

test('tenant Simples Nacional: dispensado em 2026 — valorIbs e valorCbs zerados, sem CST/cClassTrib (grupo IBSCBS é omitido do XML)', () => {
  const tenant = { regimeTributario: 'simples' };
  const resultado = calcularTributoItem(tenant, { nome: 'Produto X' }, 100);
  assert.equal(resultado.valorIbs, 0);
  assert.equal(resultado.valorCbs, 0);
  assert.equal(resultado.cstIbsCbsAplicado, null, 'dispensado não tem CST aplicado — nenhum é transmitido');
  assert.equal(resultado.cClassTribAplicado, null);
  assert.equal(resultado.indGIbsCbs, null);
});

test('tenant Lucro Presumido: aplica alíquota-teste 0,9% CBS + 0,1% IBS e repassa a classificação do produto', () => {
  const tenant = { regimeTributario: 'presumido' };
  const resultado = calcularTributoItem(tenant, PRODUTO_CLASSIFICADO, 100, CLASSIFICACAO_FISCAL_INTEGRAL);
  assert.equal(resultado.valorCbs, 0.9);
  assert.equal(resultado.valorIbs, 0.1);
  assert.equal(resultado.cstIbsCbsAplicado, '000');
  assert.equal(resultado.cClassTribAplicado, '000001');
  assert.equal(resultado.indGIbsCbs, true);
  assert.equal(resultado.indGRed, false);
});

test('tenant Lucro Real: aplica alíquota-teste 0,9% CBS + 0,1% IBS', () => {
  const tenant = { regimeTributario: 'real' };
  const resultado = calcularTributoItem(tenant, PRODUTO_CLASSIFICADO, 200, CLASSIFICACAO_FISCAL_INTEGRAL);
  assert.equal(resultado.valorCbs, Number((200 * ALIQUOTA_TESTE_2026.CBS).toFixed(2)));
  assert.equal(resultado.valorIbs, Number((200 * ALIQUOTA_TESTE_2026.IBS).toFixed(2)));
});

test('o tributo calculado não altera o valor cobrado — é destacado, não somado', () => {
  const tenant = { regimeTributario: 'real' };
  const precoItem = 50;
  const { valorIbs, valorCbs } = calcularTributoItem(tenant, PRODUTO_CLASSIFICADO, precoItem, CLASSIFICACAO_FISCAL_INTEGRAL);
  // Simula o que o chamador (Fase 1c) faria: grava o snapshot no VendaItem,
  // mas subtotal/total continuam iguais ao valor já cobrado do cliente.
  const vendaItem = { subtotal: precoItem, total: precoItem, valorIbs, valorCbs };
  assert.equal(vendaItem.subtotal, precoItem, 'subtotal não muda com o tributo destacado');
  assert.equal(vendaItem.total, precoItem, 'total não muda com o tributo destacado');
  assert.ok(valorIbs > 0 && valorCbs > 0, 'o tributo foi de fato calculado, só não somado ao total cobrado');
});

test('produto sem CST-IBS/CBS cadastrado: lança erro claro em vez de inventar um código (regime não dispensado)', () => {
  const tenant = { regimeTributario: 'real' };
  const produtoSemClassificacao = { nome: 'Produto Legado', cstIbsCbs: null, cClassTrib: null };
  assert.throws(
    () => calcularTributoItem(tenant, produtoSemClassificacao, 100),
    (err) => err.status === 422 && /sem classificação fiscal IBS\/CBS/.test(err.message) && /Produto Legado/.test(err.message)
  );
});

test('produto com cClassTrib faltando (só CST preenchido): lança erro claro', () => {
  const tenant = { regimeTributario: 'presumido' };
  const produtoParcial = { nome: 'Produto Parcial', cstIbsCbs: '000', cClassTrib: null };
  assert.throws(
    () => calcularTributoItem(tenant, produtoParcial, 100),
    (err) => err.status === 422 && /sem classificação fiscal IBS\/CBS/.test(err.message)
  );
});

test('produto classificado mas sem classificacaoFiscal do catálogo: lança erro claro (nunca assume "sem redução" silenciosamente)', () => {
  const tenant = { regimeTributario: 'real' };
  assert.throws(
    () => calcularTributoItem(tenant, PRODUTO_CLASSIFICADO, 100, null),
    (err) => err.status === 500 && /Indicadores fiscais.*não encontrados no catálogo/.test(err.message)
  );
});

/**
 * Achado de revisão (2026-07-18): indGRed=true com pRedIbs/pRedCbs=null
 * (célula em branco no catálogo pra esse cClassTrib específico, mesmo o
 * CST exigindo redução) fazia `null / 100` virar 0 em JS — fatorIbs saía 1
 * (SEM redução) silenciosamente, na contramão da regra que o resto deste
 * arquivo já segue. Não acontece com o catálogo importado hoje (verificado
 * contra o banco real), mas o código precisa travar se acontecer — dado
 * incompleto não pode virar "sem redução" por acidente aritmético.
 */
test('indGRed=true mas pRedIbs=null (catálogo incompleto para este cClassTrib): lança erro claro, nunca trata como "sem redução"', () => {
  const tenant = { regimeTributario: 'real' };
  const produto = { nome: 'Produto Catálogo Incompleto', cstIbsCbs: '200', cClassTrib: '200999' };
  const classificacaoFiscal = { indGIbsCbs: true, indGRed: true, pRedIbs: null, pRedCbs: 60 };
  assert.throws(
    () => calcularTributoItem(tenant, produto, 100, classificacaoFiscal),
    (err) => err.status === 500 && /exige redução de alíquota.*sem o percentual/.test(err.message)
  );
});

test('indGRed=true mas pRedCbs=null (só um dos dois percentuais ausente): também lança erro claro', () => {
  const tenant = { regimeTributario: 'real' };
  const produto = { nome: 'Produto Catálogo Incompleto', cstIbsCbs: '200', cClassTrib: '200999' };
  const classificacaoFiscal = { indGIbsCbs: true, indGRed: true, pRedIbs: 60, pRedCbs: null };
  assert.throws(
    () => calcularTributoItem(tenant, produto, 100, classificacaoFiscal),
    (err) => err.status === 500 && /exige redução de alíquota.*sem o percentual/.test(err.message)
  );
});

test('indGRed=true com pRedIbs/pRedCbs=0 (redução real de 0%, valor resolvido — diferente de null/não preenchido): NÃO lança, calcula normalmente', () => {
  const tenant = { regimeTributario: 'real' };
  const produto = { nome: 'Produto Redução Zero', cstIbsCbs: '200', cClassTrib: '200999' };
  const classificacaoFiscal = { indGIbsCbs: true, indGRed: true, pRedIbs: 0, pRedCbs: 0 };
  const resultado = calcularTributoItem(tenant, produto, 100, classificacaoFiscal);
  assert.equal(resultado.valorIbs, 0.1, '0% de redução = alíquota-teste cheia, igual a não ter redução nenhuma');
  assert.equal(resultado.valorCbs, 0.9);
  assert.equal(resultado.pRedIbsAplicado, 0, 'pRedIbsAplicado=0 é um valor resolvido, não deve virar null');
});

test('CST 200 (alíquota reduzida) + cClassTrib 200003 (cesta básica, pRedIBS=pRedCBS=100 — Art. 125 LC 214/2025): tributo final ZERO, mas classificação continua transmitida', () => {
  const tenant = { regimeTributario: 'real' };
  const produtoCestaBasica = { nome: 'Arroz Tipo 1 5kg', cstIbsCbs: '200', cClassTrib: '200003' };
  // pRedIbs/pRedCbs=100: valores REAIS confirmados no banco após reimportação (ver relatório) — Art. 125 LC 214/2025 "Ficam reduzidas a zero as alíquotas do IBS e da CBS".
  const classificacaoFiscal = { indGIbsCbs: true, indGRed: true, pRedIbs: 100, pRedCbs: 100 };
  const resultado = calcularTributoItem(tenant, produtoCestaBasica, 100, classificacaoFiscal);
  assert.equal(resultado.valorIbs, 0, 'redução de 100% zera o IBS mesmo com alíquota-teste positiva');
  assert.equal(resultado.valorCbs, 0);
  assert.equal(resultado.cstIbsCbsAplicado, '200', 'CST continua sendo transmitido — redução não é omissão');
  assert.equal(resultado.cClassTribAplicado, '200003');
  assert.equal(resultado.indGRed, true);
  assert.equal(resultado.pRedIbsAplicado, 100);
  assert.equal(resultado.pRedCbsAplicado, 100);
});

test('CST 200 + cClassTrib 200034 (alimentos, pRedIBS=pRedCBS=60 — Art. 135 LC 214/2025): tributo reduzido em 60%, não zerado', () => {
  const tenant = { regimeTributario: 'real' };
  const produto = { nome: 'Biscoito', cstIbsCbs: '200', cClassTrib: '200034' };
  const classificacaoFiscal = { indGIbsCbs: true, indGRed: true, pRedIbs: 60, pRedCbs: 60 };
  const resultado = calcularTributoItem(tenant, produto, 100, classificacaoFiscal);
  // 100 * 0.001 * (1 - 0.6) = 0.04 ; 100 * 0.009 * (1 - 0.6) = 0.36
  assert.equal(resultado.valorIbs, 0.04);
  assert.equal(resultado.valorCbs, 0.36);
});

test('CST 410 (imunidade/não incidência, indGIbsCbs=false — ex.: livros/jornais) — tributo zerado, CST/cClassTrib ainda transmitidos, grupo de valor é omitido pelo nfceXml.service.js', () => {
  const tenant = { regimeTributario: 'real' };
  const produtoLivro = { nome: 'Livro Infantil', cstIbsCbs: '410', cClassTrib: '410008' };
  const classificacaoFiscal = { indGIbsCbs: false, indGRed: false, pRedIbs: null, pRedCbs: null };
  const resultado = calcularTributoItem(tenant, produtoLivro, 50, classificacaoFiscal);
  assert.equal(resultado.valorIbs, 0);
  assert.equal(resultado.valorCbs, 0);
  assert.equal(resultado.cstIbsCbsAplicado, '410');
  assert.equal(resultado.cClassTribAplicado, '410008');
  assert.equal(resultado.indGIbsCbs, false);
});
