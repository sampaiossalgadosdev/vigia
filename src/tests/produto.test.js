/**
 * Arquivo: produto.test.js
 * Responsabilidade: Provar duas coisas sobre os 4 campos fiscais de Produto
 * (ncm, cfop, cstIbsCbs, cClassTrib):
 *   1) Um código fora do catálogo oficial (ou fora do formato) é sempre
 *      rejeitado — mesmo bem formatado, se não existir/estiver vigente na
 *      tabela de referência, é 422.
 *   2) Os 4 campos são OBRIGATÓRIOS (decisão de produto: cadastro é feito
 *      por gerente/funcionário sem pressão de tempo, não pelo caixa na
 *      venda) — tanto em criação quanto em edição, incluindo o caso de
 *      "limpar" um campo já preenchido num produto existente.
 * Os testes usam códigos REAIS já importados pelos scripts (mesmo princípio
 * de catalogoFiscal.test.js: provar com dado oficial de verdade, não
 * fixture inventada).
 * Uso: node --test src/tests/produto.test.js
 * Depende de: DATABASE_URL válido em .env, e de scripts/importarCatalogoNcm.js,
 * scripts/importarCatalogoCfop.js e scripts/importarCatalogoClassTrib.js já
 * terem rodado.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const produtoService = require('../services/produto.service');
const { criar: validarCriar, atualizar: validarAtualizar } = require('../validators/produto.validator');

const NCM_REAL = '01012100';
const CFOP_REAL = '5102';
const CST_IBS_CBS_REAL = '000';
const CLASS_TRIB_REAL = '000001';

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Produto ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `produto-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

// Mesmo helper de src/tests/promocao.test.js: roda a cadeia real do
// express-validator contra um body, sem precisar subir servidor HTTP.
async function rodarValidacao(cadeia, bodyOriginal) {
  const req = { body: { ...bodyOriginal } };
  let statusCode = 200;
  let payload = null;
  const res = {
    status(codigo) { statusCode = codigo; return this; },
    json(dados) { payload = dados; return this; },
  };
  for (const regra of cadeia) {
    if (typeof regra.run === 'function') await regra.run(req);
    else regra(req, res, () => {});
  }
  return { body: req.body, statusCode, payload };
}

// Os 4 campos fiscais são obrigatórios agora — produtoBase() já vem com os
// 4 preenchidos com códigos reais e válidos, pra que cada teste isolado
// (ex: "NCM inválido") só precise sobrescrever o campo que está testando,
// sem os outros 3 travarem o resultado por estarem vazios.
function produtoBase(overrides = {}) {
  return {
    ean: '9990000000001', nome: 'Produto Teste Catálogo', preco: '10.50',
    ncm: NCM_REAL, cfop: CFOP_REAL, cstIbsCbs: CST_IBS_CBS_REAL, cClassTrib: CLASS_TRIB_REAL,
    ...overrides,
  };
}

test('NCM: código real e vigente (do catálogo oficial já importado) passa na validação', async () => {
  const { statusCode } = await rodarValidacao(validarCriar, produtoBase({ ncm: NCM_REAL }));
  assert.equal(statusCode, 200);
});

test('NCM: código com formato válido (8 dígitos) mas que não existe no catálogo é rejeitado com 422', async () => {
  const { statusCode, payload } = await rodarValidacao(validarCriar, produtoBase({ ncm: '99999999' }));
  assert.equal(statusCode, 422);
  assert.ok(payload.errors.some((e) => /NCM não encontrado no catálogo/i.test(e)), `esperava erro de catálogo, veio: ${JSON.stringify(payload.errors)}`);
});

test('NCM: formato inválido (menos de 8 dígitos) é rejeitado antes mesmo de consultar o catálogo', async () => {
  const { statusCode, payload } = await rodarValidacao(validarCriar, produtoBase({ ncm: '123' }));
  assert.equal(statusCode, 422);
  assert.ok(payload.errors.some((e) => /8 dígitos/i.test(e)));
});

test('CFOP: código real e vigente (do catálogo oficial já importado) passa na validação', async () => {
  const { statusCode } = await rodarValidacao(validarCriar, produtoBase({ cfop: CFOP_REAL }));
  assert.equal(statusCode, 200);
});

test('CFOP: código com formato válido (4 dígitos) mas que não existe no catálogo é rejeitado com 422', async () => {
  const { statusCode, payload } = await rodarValidacao(validarCriar, produtoBase({ cfop: '9999' }));
  assert.equal(statusCode, 422);
  assert.ok(payload.errors.some((e) => /CFOP não encontrado no catálogo/i.test(e)), `esperava erro de catálogo, veio: ${JSON.stringify(payload.errors)}`);
});

test('CST-IBS/CBS: código real e vigente (do catálogo oficial já importado) passa na validação; código bem formatado mas inexistente é rejeitado com 422', async () => {
  const { statusCode: valido } = await rodarValidacao(validarCriar, produtoBase({ cstIbsCbs: CST_IBS_CBS_REAL }));
  assert.equal(valido, 200);

  const { statusCode: invalido, payload } = await rodarValidacao(validarCriar, produtoBase({ cstIbsCbs: '999' }));
  assert.equal(invalido, 422);
  assert.ok(payload.errors.some((e) => /CST-IBS\/CBS não encontrado no catálogo/i.test(e)));
});

test('cClassTrib: código real e vigente (do catálogo oficial já importado) passa na validação; código bem formatado mas inexistente é rejeitado com 422', async () => {
  const { statusCode: valido } = await rodarValidacao(validarCriar, produtoBase({ cClassTrib: CLASS_TRIB_REAL }));
  assert.equal(valido, 200);

  const { statusCode: invalido, payload } = await rodarValidacao(validarCriar, produtoBase({ cClassTrib: '999999' }));
  assert.equal(invalido, 422);
  assert.ok(payload.errors.some((e) => /cClassTrib não encontrado no catálogo/i.test(e)));
});

test('cstIbsCbs/cClassTrib: formato inválido (dígitos errados) é rejeitado antes de consultar o catálogo', async () => {
  const { statusCode: cst, payload: payloadCst } = await rodarValidacao(validarCriar, produtoBase({ cstIbsCbs: '12' }));
  assert.equal(cst, 422);
  assert.ok(payloadCst.errors.some((e) => /3 dígitos/i.test(e)));

  const { statusCode: classTrib, payload: payloadClassTrib } = await rodarValidacao(validarCriar, produtoBase({ cClassTrib: '12' }));
  assert.equal(classTrib, 422);
  assert.ok(payloadClassTrib.errors.some((e) => /6 dígitos/i.test(e)));
});

test('Criar produto sem NCM (campo vazio) é rejeitado — NCM passou a ser obrigatório', async () => {
  const { statusCode, payload } = await rodarValidacao(validarCriar, produtoBase({ ncm: '' }));
  assert.equal(statusCode, 422);
  assert.ok(payload.errors.includes('NCM é obrigatório'), `esperava "NCM é obrigatório", veio: ${JSON.stringify(payload.errors)}`);
});

test('Criar produto sem CFOP (campo vazio) é rejeitado — CFOP passou a ser obrigatório', async () => {
  const { statusCode, payload } = await rodarValidacao(validarCriar, produtoBase({ cfop: '' }));
  assert.equal(statusCode, 422);
  assert.ok(payload.errors.includes('CFOP é obrigatório'), `esperava "CFOP é obrigatório", veio: ${JSON.stringify(payload.errors)}`);
});

test('Criar produto sem CST-IBS/CBS (campo vazio) é rejeitado — passou a ser obrigatório', async () => {
  const { statusCode, payload } = await rodarValidacao(validarCriar, produtoBase({ cstIbsCbs: '' }));
  assert.equal(statusCode, 422);
  assert.ok(payload.errors.includes('CST-IBS/CBS é obrigatório'), `esperava "CST-IBS/CBS é obrigatório", veio: ${JSON.stringify(payload.errors)}`);
});

test('Criar produto sem cClassTrib (campo vazio) é rejeitado — passou a ser obrigatório', async () => {
  const { statusCode, payload } = await rodarValidacao(validarCriar, produtoBase({ cClassTrib: '' }));
  assert.equal(statusCode, 422);
  assert.ok(payload.errors.includes('cClassTrib é obrigatório'), `esperava "cClassTrib é obrigatório", veio: ${JSON.stringify(payload.errors)}`);
});

test('Criar produto com os 4 campos fiscais válidos é aceito', async () => {
  const { statusCode } = await rodarValidacao(validarCriar, produtoBase());
  assert.equal(statusCode, 200);
});

test('Criar produto sem NENHUM dos 4 campos: as 4 mensagens de "obrigatório" aparecem juntas, uma por campo', async () => {
  const { statusCode, payload } = await rodarValidacao(validarCriar, produtoBase({ ncm: '', cfop: '', cstIbsCbs: '', cClassTrib: '' }));
  assert.equal(statusCode, 422);
  assert.ok(payload.errors.includes('NCM é obrigatório'));
  assert.ok(payload.errors.includes('CFOP é obrigatório'));
  assert.ok(payload.errors.includes('CST-IBS/CBS é obrigatório'));
  assert.ok(payload.errors.includes('cClassTrib é obrigatório'));
});

test('Editar produto existente limpando um dos 4 campos fiscais (ex: cClassTrib) é rejeitado — mesmo efeito colateral aceito para produto antigo sem esses dados', async () => {
  const { statusCode, payload } = await rodarValidacao(validarAtualizar, produtoBase({ nome: 'Produto Editado', preco: '15', cClassTrib: '' }));
  assert.equal(statusCode, 422);
  assert.ok(payload.errors.includes('cClassTrib é obrigatório'));
});

test('Editar produto já com os 4 campos fiscais completos, mudando só o preço, é aceito (caso comum não trava)', async () => {
  const { statusCode } = await rodarValidacao(validarAtualizar, produtoBase({ nome: 'Produto Editado', preco: '15' }));
  assert.equal(statusCode, 200);
});

test('REGRESSÃO (normalizar() precisa incluir cstIbsCbs/cClassTrib na whitelist): produtoService.criar() persiste os dois campos no banco, não os descarta silenciosamente', async () => {
  // Testa a camada de serviço diretamente (sem passar pelo validator, que
  // hoje rejeitaria qualquer valor de cstIbsCbs/cClassTrib porque os
  // catálogos ainda não foram populados) — o ponto aqui é provar que,
  // quando um valor bem-formado chega até o service, ele é gravado de
  // verdade, e não descartado pelo whitelist de campos de normalizar().
  const tenant = await criarTenant('01');
  try {
    const usuario = { id: 'usuario-teste' };
    const produto = await produtoService.criar(tenant.id, {
      ean: '9990000000002', nome: 'Produto Teste Whitelist', preco: '10',
      cstIbsCbs: '000', cClassTrib: '000001',
    }, usuario, '127.0.0.1');

    assert.equal(produto.cstIbsCbs, '000', 'cstIbsCbs não pode ser descartado por normalizar()');
    assert.equal(produto.cClassTrib, '000001', 'cClassTrib não pode ser descartado por normalizar()');

    const lido = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(lido.cstIbsCbs, '000');
    assert.equal(lido.cClassTrib, '000001');
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
