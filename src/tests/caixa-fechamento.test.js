/**
 * Arquivo: caixa-fechamento.test.js
 * Responsabilidade: Regressão do fechamento de caixa "cego" (Fase 4a,
 * Tarefa B). A correção em si é só de front-end (public/caixa.html) — o
 * backend (caixa.service.fechar) já calculava `diferenca` corretamente e
 * não muda. Este arquivo cobre dois ângulos:
 * 1) Contrato do backend: fechar() devolve tudo que a tela precisa pra
 *    montar a comparação (valorFechamento, totalVendas, diferenca) numa
 *    única resposta, sem exigir uma consulta separada que exporia o valor
 *    do sistema antes da hora.
 * 2) Checagem estrutural de public/caixa.html: a etapa de contagem do
 *    modal de fechamento não referencia o valor do sistema em nenhum
 *    lugar, e a atribuição do valor do sistema no resultado só ocorre
 *    textualmente DEPOIS do POST /api/caixa/fechar — não há teste de
 *    tela automatizado neste projeto (sem jsdom/puppeteer), então esta é
 *    a checagem de sequência possível dado o que existe hoje.
 * Uso: node --test src/tests/caixa-fechamento.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../config/database');
const caixaService = require('../services/caixa.service');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Caixa Fechamento ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `caixa-fech-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.sangria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('backend: fechar() devolve valorFechamento + totalVendas + diferenca numa única resposta (tudo que a tela precisa pra comparar depois do POST)', async () => {
  const tenant = await criarTenant('01');
  try {
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 100, totalVendas: 250 } });

    // Durante o expediente normal (fora do fluxo de fechamento), o valor do
    // sistema É legítimo de aparecer — isso não é o bug corrigido aqui.
    const antesDeFechar = await caixaService.atual(tenant.id);
    assert.equal(antesDeFechar.status, 'aberto');
    assert.equal(Number(antesDeFechar.totalVendas), 250);

    const fechado = await caixaService.fechar(tenant.id, { valorFechamento: '240' }, { id: 'usuario-teste' }, '127.0.0.1');
    assert.equal(Number(fechado.valorFechamento), 240);
    assert.equal(Number(fechado.totalVendas), 250);
    assert.equal(Number(fechado.diferenca), -10);

    // Depois de fechado, não há mais caixa "aberto" pra expor o valor —
    // atual() passa a devolver o placeholder (o front-end pára de mostrar
    // o card de vendas do dia como se ainda estivesse rodando).
    const depoisDeFechar = await caixaService.atual(tenant.id);
    assert.equal(depoisDeFechar.status, 'fechado');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('estrutura de public/caixa.html: a etapa de contagem do modal não expõe o valor do sistema, e o resultado só é preenchido depois do POST de fechamento', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'caixa.html'), 'utf8');

  const inicioEtapaContagem = html.indexOf('id="fecharEtapaContagem"');
  const inicioEtapaResultado = html.indexOf('id="fecharEtapaResultado"');
  assert.ok(inicioEtapaContagem > -1 && inicioEtapaResultado > -1, 'o modal de fechamento deve ter as duas etapas (contagem e resultado)');

  const blocoContagem = html.slice(inicioEtapaContagem, inicioEtapaResultado);
  assert.doesNotMatch(blocoContagem, /resValorSistema|totalVendas|vendasDia/, 'a etapa de contagem não pode referenciar o valor do sistema em nenhum elemento');

  // No script: abrir o modal de fechamento tem que esconder o card de
  // "Vendas do dia" — e essa função não pode setar nenhum valor de sistema.
  const funcaoAbrir = html.match(/function abrirModalFechar\(\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(funcaoAbrir, 'deve existir a função abrirModalFechar');
  assert.match(funcaoAbrir[0], /cardVendasDia\.style\.display\s*=\s*'none'/, 'abrir o modal de fechamento deve esconder o card de vendas do dia');
  assert.doesNotMatch(funcaoAbrir[0], /resValorSistema|totalVendas/, 'abrir o modal não pode expor o valor do sistema');

  // A atribuição do valor do sistema no resultado só pode ocorrer depois
  // (textualmente, no código) do POST /api/caixa/fechar ser chamado.
  const indicePost = html.indexOf("API.post('/api/caixa/fechar'");
  const indiceAtribuicaoResultado = html.indexOf("resValorSistema').textContent");
  assert.ok(indicePost > -1 && indiceAtribuicaoResultado > -1);
  assert.ok(indiceAtribuicaoResultado > indicePost, 'o valor do sistema no resultado só pode ser atribuído depois do POST de fechamento no código');
});

after(async () => {
  await prisma.$disconnect();
});
