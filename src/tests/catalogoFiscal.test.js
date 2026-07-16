/**
 * Arquivo: catalogoFiscal.test.js
 * Responsabilidade: Regressão dos catálogos fiscais de referência (NCM,
 * CFOP, CST-IBS/CBS, cClassTrib) — busca (autocomplete do cadastro de
 * produto) e existência (usada pelo validator). Todos os testes usam
 * códigos REAIS já importados pelos scripts (não fixtures inventadas) — o
 * ponto desta tarefa é provar que os dados vieram de fonte oficial de
 * verdade, não de texto livre.
 * Uso: node --test src/tests/catalogoFiscal.test.js
 * Depende de: DATABASE_URL válido em .env — e de scripts/importarCatalogoNcm.js,
 * scripts/importarCatalogoCfop.js e scripts/importarCatalogoClassTrib.js já
 * terem rodado (senão os testes de busca/existência com dado real falham
 * "de propósito", sinalizando que a importação ainda não aconteceu).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const repo = require('../repositories/catalogoFiscal.repository');

// Código real, confirmado presente na fonte oficial (Portal Único Siscomex)
// no momento da importação desta tarefa — "0101.21.00", Reprodutores de
// raça pura, capítulo 01 (Animais vivos).
const NCM_REAL = '01012100';
// CFOP real, o mais comum do varejo — "Venda de mercadoria adquirida ou
// recebida de terceiros" (venda de mercadoria de revenda, não de produção
// própria — essa é a 5101).
const CFOP_REAL = '5102';

test('buscarNcm: encontra por código exato/parcial e por trecho da descrição, usando dados reais já importados', async () => {
  const porCodigo = await repo.buscarNcm(NCM_REAL);
  assert.ok(porCodigo.some((n) => n.codigo === NCM_REAL), `esperava encontrar ${NCM_REAL} buscando pelo próprio código`);

  const porDescricaoParcial = await repo.buscarNcm('Reprodutores de raça pura');
  assert.ok(porDescricaoParcial.some((n) => n.codigo === NCM_REAL), 'esperava encontrar por trecho da descrição oficial');
});

test('buscarNcm: termo vazio ou com 1 caractere não bate no banco, devolve vazio', async () => {
  assert.deepEqual(await repo.buscarNcm(''), []);
  assert.deepEqual(await repo.buscarNcm('a'), []);
});

test('existeNcm: código real e vigente retorna true; código inventado retorna false', async () => {
  assert.equal(await repo.existeNcm(NCM_REAL), true);
  assert.equal(await repo.existeNcm('99999999'), false);
});

test('buscarCfop: encontra por código e por descrição, formato sem ponto (mesmo formato de Produto.cfop)', async () => {
  const porCodigo = await repo.buscarCfop(CFOP_REAL);
  assert.ok(porCodigo.some((c) => c.codigo === CFOP_REAL), `esperava encontrar ${CFOP_REAL} (sem ponto) buscando pelo código`);
  assert.ok(!porCodigo.some((c) => c.codigo.includes('.')), 'nenhum código de CFOP deve conter ponto — precisa bater com o formato de Produto.cfop');

  const porDescricao = await repo.buscarCfop('mercadoria adquirida ou recebida de terceiros');
  assert.ok(porDescricao.some((c) => c.codigo === CFOP_REAL));
});

test('existeCfop: código real retorna true; código fora da tabela (9999) retorna false', async () => {
  assert.equal(await repo.existeCfop(CFOP_REAL), true);
  assert.equal(await repo.existeCfop('9999'), false);
});

test('CFOP: tipoOperacao é derivado corretamente do primeiro dígito (entrada 1-3, saída 5-7)', async () => {
  const entrada = await prisma.catalogoCfop.findUnique({ where: { codigo: '1101' } });
  const saida = await prisma.catalogoCfop.findUnique({ where: { codigo: '5101' } });
  assert.equal(entrada.tipoOperacao, 'entrada');
  assert.equal(saida.tipoOperacao, 'saida');
});

test('vigência: um código com dataFimVigencia no passado não aparece na busca nem na checagem de existência (defesa em profundidade — nenhum código real está descontinuado hoje, então isso é testado com um registro fabricado só para este teste)', async () => {
  const codigoTeste = 'NCM-TESTE-VENCIDO';
  await prisma.catalogoNcm.create({
    data: { codigo: codigoTeste, descricao: 'Código de teste já vencido', dataFimVigencia: new Date('2020-01-01') },
  });
  try {
    assert.equal(await repo.existeNcm(codigoTeste), false, 'código com dataFimVigencia no passado não deve ser considerado válido');
    const busca = await repo.buscarNcm(codigoTeste);
    assert.equal(busca.length, 0, 'código vencido não deve aparecer nas sugestões de busca');
  } finally {
    await prisma.catalogoNcm.delete({ where: { codigo: codigoTeste } }).catch(() => {});
  }
});

test('CatalogoCst: populado a partir do XSD oficial — 15 códigos ICMS, incluindo os mais comuns', async () => {
  const total = await prisma.catalogoCst.count();
  assert.equal(total, 15);
  const tributadaIntegralmente = await prisma.catalogoCst.findUnique({ where: { codigo: '00' } });
  assert.equal(tributadaIntegralmente.descricao, 'Tributada integralmente');
});

test('CatalogoCsosn: populado a partir do XSD oficial — exatamente 10 códigos (tabela oficial do Simples Nacional)', async () => {
  const total = await prisma.catalogoCsosn.count();
  assert.equal(total, 10);
});

// Código real, confirmado presente na fonte oficial (Informe Técnico RT
// 2025.002, Portal Nacional da NF-e) — "000", Tributação integral.
const CST_IBS_CBS_REAL = '000';
// cClassTrib real, mesma fonte — "000001", Situações tributadas
// integralmente pelo IBS e CBS.
const CLASS_TRIB_REAL = '000001';

test('CatalogoCstIbsCbs: populado a partir do Informe Técnico RT 2025.002 — exatamente 18 códigos (TCST da Reforma)', async () => {
  const total = await prisma.catalogoCstIbsCbs.count();
  assert.equal(total, 18);
});

test('CatalogoClassTrib: populado a partir do Informe Técnico RT 2025.002 — exatamente 164 códigos', async () => {
  const total = await prisma.catalogoClassTrib.count();
  assert.equal(total, 164);
});

test('buscarCstIbsCbs/existeCstIbsCbs: encontra por código e por descrição, usando dado real já importado; código inventado não existe', async () => {
  const porCodigo = await repo.buscarCstIbsCbs(CST_IBS_CBS_REAL);
  assert.ok(porCodigo.some((c) => c.codigo === CST_IBS_CBS_REAL));
  const porDescricao = await repo.buscarCstIbsCbs('Tributação integral');
  assert.ok(porDescricao.some((c) => c.codigo === CST_IBS_CBS_REAL));
  assert.equal(await repo.existeCstIbsCbs(CST_IBS_CBS_REAL), true);
  assert.equal(await repo.existeCstIbsCbs('999'), false);
});

test('buscarClassTrib/existeClassTrib: encontra por código e por descrição, usando dado real já importado; código inventado não existe', async () => {
  const porCodigo = await repo.buscarClassTrib(CLASS_TRIB_REAL);
  assert.ok(porCodigo.some((c) => c.codigo === CLASS_TRIB_REAL));
  const porDescricao = await repo.buscarClassTrib('Situações tributadas integralmente pelo IBS e CBS');
  assert.ok(porDescricao.some((c) => c.codigo === CLASS_TRIB_REAL));
  assert.equal(await repo.existeClassTrib(CLASS_TRIB_REAL), true);
  assert.equal(await repo.existeClassTrib('999999'), false);
});

test('CatalogoClassTrib: 3 códigos de incorporação imobiliária (220001/220002/220003) têm dataInicioVigencia == dataFimVigencia (2026-01-01) na própria fonte oficial — encerrados no mesmo dia em que entraram em vigor, não devem aparecer como vigentes hoje', async () => {
  assert.equal(await repo.existeClassTrib('220001'), false);
  assert.equal(await repo.existeClassTrib('220002'), false);
  assert.equal(await repo.existeClassTrib('220003'), false);
});

after(async () => {
  await prisma.$disconnect();
});
