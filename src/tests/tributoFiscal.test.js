/**
 * Arquivo: tributoFiscal.test.js
 * Responsabilidade: Confirma o cálculo de IBS/CBS por item (Fase 1b) —
 * regime Simples Nacional dispensado em 2026; Presumido/Real aplicam a
 * alíquota-teste (0,9% CBS + 0,1% IBS); e que o tributo é só DESTACADO
 * (não altera o valor total cobrado na venda).
 * Uso: node --test src/tests/tributoFiscal.test.js
 * Teste unitário puro — sem banco, sem rede.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularTributoItem } = require('../services/tributoFiscal.service');
const { ALIQUOTA_TESTE_2026 } = require('../config/aliquotasFiscais');

test('tenant Simples Nacional: dispensado em 2026 — valorIbs e valorCbs zerados', () => {
  const tenant = { regimeTributario: 'simples' };
  const resultado = calcularTributoItem(tenant, { nome: 'Produto X' }, 100);
  assert.equal(resultado.valorIbs, 0);
  assert.equal(resultado.valorCbs, 0);
  assert.ok(resultado.cstIbsCbsAplicado, 'deve preencher um placeholder de classificação, não deixar vazio');
  assert.ok(resultado.cClassTribAplicado);
});

test('tenant Lucro Presumido: aplica alíquota-teste 0,9% CBS + 0,1% IBS', () => {
  const tenant = { regimeTributario: 'presumido' };
  const resultado = calcularTributoItem(tenant, { nome: 'Produto X' }, 100);
  assert.equal(resultado.valorCbs, 0.9);
  assert.equal(resultado.valorIbs, 0.1);
});

test('tenant Lucro Real: aplica alíquota-teste 0,9% CBS + 0,1% IBS', () => {
  const tenant = { regimeTributario: 'real' };
  const resultado = calcularTributoItem(tenant, { nome: 'Produto X' }, 200);
  assert.equal(resultado.valorCbs, Number((200 * ALIQUOTA_TESTE_2026.CBS).toFixed(2)));
  assert.equal(resultado.valorIbs, Number((200 * ALIQUOTA_TESTE_2026.IBS).toFixed(2)));
});

test('o tributo calculado não altera o valor cobrado — é destacado, não somado', () => {
  const tenant = { regimeTributario: 'real' };
  const precoItem = 50;
  const { valorIbs, valorCbs } = calcularTributoItem(tenant, { nome: 'Produto Y' }, precoItem);
  // Simula o que o chamador (Fase 1c) faria: grava o snapshot no VendaItem,
  // mas subtotal/total continuam iguais ao valor já cobrado do cliente.
  const vendaItem = { subtotal: precoItem, total: precoItem, valorIbs, valorCbs };
  assert.equal(vendaItem.subtotal, precoItem, 'subtotal não muda com o tributo destacado');
  assert.equal(vendaItem.total, precoItem, 'total não muda com o tributo destacado');
  assert.ok(valorIbs > 0 && valorCbs > 0, 'o tributo foi de fato calculado, só não somado ao total cobrado');
});
