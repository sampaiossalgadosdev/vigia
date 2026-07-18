/**
 * Arquivo: pdv-snapshot.test.js
 * Responsabilidade: Regressão da Fase 3a — GET /api/pdv/snapshot.
 * Cobre: escopo por tenant (um tenant nunca recebe produto/estoque/lote de
 * outro), presença de preço/estoque/lote no formato esperado e a premissa
 * de assumir o Depósito Principal do tenant.
 * Uso: node --test src/tests/pdv-snapshot.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const pdvSnapshotService = require('../services/pdvSnapshot.service');
const { backfillTenant } = require('../scripts/migrarDepositos');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Snapshot PDV ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `snapshot-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.lote.deleteMany({ where: { estoqueProduto: { produto: { tenantId } } } }).catch(() => {});
  await prisma.estoqueProduto.deleteMany({ where: { produto: { tenantId } } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.deposito.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('snapshot: retorna produto, preço, estoque e permiteEstoqueNegativo do Depósito Principal', async () => {
  const tenant = await criarTenant('01');
  try {
    const produto = await prisma.produto.create({
      data: {
        tenantId: tenant.id, ean: '9700000000001', codigoReferencia: 'REF-001', unidade: 'CX', nome: 'Produto Snapshot',
        preco: 12.5, estoqueQtd: 20, ncm: '22021000', cfop: '5102',
      },
    });
    await backfillTenant(tenant.id);
    const deposito = await prisma.deposito.findFirst({ where: { tenantId: tenant.id, principal: true } });
    await prisma.estoqueProduto.update({
      where: { produtoId_depositoId: { produtoId: produto.id, depositoId: deposito.id } },
      data: { permiteEstoqueNegativo: false },
    });

    const snapshot = await pdvSnapshotService.montar(tenant.id);

    assert.equal(snapshot.depositoId, deposito.id, 'snapshot deve assumir o Depósito Principal do tenant');
    assert.equal(snapshot.produtos.length, 1);
    const [p] = snapshot.produtos;
    assert.equal(p.id, produto.id);
    assert.equal(p.precoVenda, 12.5);
    assert.equal(p.codigoReferencia, 'REF-001', 'snapshot deve trazer codigoReferencia (Fase 3b: busca local por código de referência)');
    assert.equal(p.unidade, 'CX', 'snapshot deve trazer unidade');
    assert.equal(p.ativo, true, 'snapshot deve trazer ativo (Fase 3b: busca local não pode sugerir produto inativo)');
    assert.equal(p.permiteEstoqueNegativo, false, 'permiteEstoqueNegativo deve vir do EstoqueProduto do Depósito Principal');
    assert.ok(p.origemVersao, 'produto deve trazer campo de versão (origemVersao)');
    assert.equal(p.ncm, '22021000', 'snapshot deve trazer NCM (necessário pra montar XML de NFC-e em contingência)');
    assert.equal(p.cfop, '5102', 'snapshot deve trazer CFOP (necessário pra montar XML de NFC-e em contingência)');

    assert.equal(snapshot.estoque.length, 1);
    assert.equal(snapshot.estoque[0].quantidade, 20);
    assert.ok(snapshot.estoque[0].atualizadoEm, 'estoque deve trazer campo de versão (atualizadoEm)');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('snapshot: inclui lotes ativos do produto com controlaLote=true', async () => {
  const tenant = await criarTenant('02');
  try {
    const produto = await prisma.produto.create({
      data: { tenantId: tenant.id, ean: '9700000000002', nome: 'Produto Com Lote', preco: 8, controlaLote: true },
    });
    const deposito = await prisma.deposito.create({ data: { tenantId: tenant.id, nome: 'Depósito Principal', principal: true } });
    const estoqueProduto = await prisma.estoqueProduto.create({ data: { produtoId: produto.id, depositoId: deposito.id, quantidade: 10 } });
    await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: new Date(Date.now() + 86400000 * 30), quantidade: 10 } });

    const snapshot = await pdvSnapshotService.montar(tenant.id);
    assert.equal(snapshot.lotes.length, 1);
    assert.equal(snapshot.lotes[0].produtoId, produto.id);
    assert.equal(snapshot.lotes[0].quantidade, 10);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('snapshot: escopo por tenant — tenant A nunca recebe produto/estoque/lote do tenant B', async () => {
  const tenantA = await criarTenant('03');
  const tenantB = await criarTenant('04');
  try {
    const produtoA = await prisma.produto.create({ data: { tenantId: tenantA.id, ean: '9700000000003', nome: 'Produto A', preco: 5, estoqueQtd: 3 } });
    const produtoB = await prisma.produto.create({ data: { tenantId: tenantB.id, ean: '9700000000004', nome: 'Produto B', preco: 7, estoqueQtd: 9 } });
    await backfillTenant(tenantA.id);
    await backfillTenant(tenantB.id);

    const snapshotA = await pdvSnapshotService.montar(tenantA.id);
    const snapshotB = await pdvSnapshotService.montar(tenantB.id);

    assert.equal(snapshotA.produtos.length, 1);
    assert.equal(snapshotA.produtos[0].id, produtoA.id);
    assert.ok(!snapshotA.produtos.some((p) => p.id === produtoB.id), 'snapshot do tenant A não pode conter produto do tenant B');
    assert.notEqual(snapshotA.depositoId, snapshotB.depositoId, 'cada tenant deve ter seu próprio Depósito Principal');

    assert.equal(snapshotB.produtos.length, 1);
    assert.equal(snapshotB.produtos[0].id, produtoB.id);
    assert.ok(!snapshotB.produtos.some((p) => p.id === produtoA.id), 'snapshot do tenant B não pode conter produto do tenant A');
  } finally {
    await limparTenant(tenantA.id);
    await limparTenant(tenantB.id);
  }
});

test('snapshot: bloco fiscal traz endereço/CRT/cUF/emiteIbsCbs pré-calculados, nunca certificado ou CSC', async () => {
  const tenant = await prisma.tenant.create({
    data: {
      nome: 'Teste Snapshot Fiscal', cnpj: cnpjTeste('05'), email: `snapshot-fiscal-${Date.now()}@teste.com`,
      uf: 'PR', regimeTributario: 'presumido', ambienteFiscal: 'homologacao',
      inscricaoEstadual: '1234567890', logradouro: 'Rua Teste', numero: '100', bairro: 'Centro',
      municipio: 'Curitiba', codigoMunicipioIbge: '4106902', cep: '80000000',
      certificadoPfx: Buffer.from('nao-pode-vazar'), certificadoSenha: 'nao-pode-vazar',
    },
  });
  try {
    const snapshot = await pdvSnapshotService.montar(tenant.id);

    assert.equal(snapshot.fiscal.cnpj, tenant.cnpj);
    assert.equal(snapshot.fiscal.uf, 'PR');
    assert.equal(snapshot.fiscal.cUF, '41', 'cUF pré-calculado a partir da UF (mesma tabela de sefaz.service.js)');
    assert.equal(snapshot.fiscal.crt, 3, 'crt pré-calculado a partir do regimeTributario (presumido = 3, mesma tabela de aliquotasFiscais.js)');
    assert.equal(snapshot.fiscal.emiteIbsCbs, true, 'presumido não é dispensado em 2026 — deve emitir IBS/CBS');
    assert.equal(snapshot.fiscal.aliquotaIbs, 0.001, 'alíquota-teste de IBS 2026 pré-calculada (0,1%)');
    assert.equal(snapshot.fiscal.aliquotaCbs, 0.009, 'alíquota-teste de CBS 2026 pré-calculada (0,9%)');
    assert.equal(snapshot.fiscal.logradouro, 'Rua Teste');
    assert.equal(snapshot.fiscal.codigoMunicipioIbge, '4106902');

    assert.equal(snapshot.fiscal.certificadoPfx, undefined, 'bloco fiscal nunca pode trazer o certificado');
    assert.equal(snapshot.fiscal.certificadoSenha, undefined, 'bloco fiscal nunca pode trazer a senha do certificado');
    assert.ok(!JSON.stringify(snapshot).includes('nao-pode-vazar'), 'certificado/senha não podem aparecer em nenhum lugar do snapshot serializado');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('snapshot: tenant Simples Nacional (default) tem emiteIbsCbs=false (dispensado em 2026)', async () => {
  const tenant = await criarTenant('06');
  try {
    const snapshot = await pdvSnapshotService.montar(tenant.id);
    assert.equal(snapshot.fiscal.crt, 1, 'simples = CRT 1');
    assert.equal(snapshot.fiscal.emiteIbsCbs, false, 'Simples Nacional é dispensado de destacar IBS/CBS em 2026');
  } finally {
    await limparTenant(tenant.id);
  }
});

/**
 * cstIbsCbs/cClassTrib por produto + indicadores resolvidos (indGIbsCbs/
 * indGRed/pRedIbs/pRedCbs) — dado que o PDV vai precisar pra montar o XML
 * de contingência sem placeholder fixo (NT 2025.002-RTC v1.50; camadas 2 e
 * 3 desse gap — schema SQLite e nfceContingencia.js do vigia-pdv — ficam
 * pendentes, fora do escopo desta tarefa). '000'/'000001', '200'/'200003' e
 * '410'/'410008' são códigos REAIS já usados em tributoFiscal.test.js/
 * nfceXml.test.js/catalogoFiscal.test.js — mesma fonte oficial.
 */
async function criarTenantPresumido(sufixo) {
  return prisma.tenant.create({
    data: {
      nome: `Teste Snapshot Fiscal Produto ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `snapshot-fiscal-prod-${sufixo}-${Date.now()}@teste.com`,
      uf: 'PR', regimeTributario: 'presumido', ambienteFiscal: 'homologacao',
      inscricaoEstadual: '1234567890', logradouro: 'Rua Teste', numero: '100', bairro: 'Centro',
      municipio: 'Curitiba', codigoMunicipioIbge: '4106902', cep: '80000000',
    },
  });
}

test('snapshot: produto CST 000 (tributação integral) — indGIbsCbs=true, indGRed=false, sem percentual de redução', async () => {
  const tenant = await criarTenantPresumido('07');
  try {
    const produto = await prisma.produto.create({
      data: { tenantId: tenant.id, ean: '9700000000007', nome: 'Arroz', preco: 10, ncm: '10063011', cfop: '5102', cstIbsCbs: '000', cClassTrib: '000001' },
    });
    await backfillTenant(tenant.id);

    const snapshot = await pdvSnapshotService.montar(tenant.id);
    const [p] = snapshot.produtos;
    assert.equal(p.cstIbsCbs, '000');
    assert.equal(p.cClassTrib, '000001');
    assert.equal(p.indGIbsCbs, true);
    assert.equal(p.indGRed, false);
    assert.equal(p.pRedIbs, 0);
    assert.equal(p.pRedCbs, 0);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('snapshot: produto CST 200 + cClassTrib 200003 (cesta básica) — indGRed=true, pRedIbs=pRedCbs=100 (Art. 125 LC 214/2025)', async () => {
  const tenant = await criarTenantPresumido('08');
  try {
    const produto = await prisma.produto.create({
      data: { tenantId: tenant.id, ean: '9700000000008', nome: 'Feijão', preco: 8, ncm: '07133399', cfop: '5102', cstIbsCbs: '200', cClassTrib: '200003' },
    });
    await backfillTenant(tenant.id);

    const snapshot = await pdvSnapshotService.montar(tenant.id);
    const [p] = snapshot.produtos;
    assert.equal(p.indGIbsCbs, true);
    assert.equal(p.indGRed, true);
    assert.equal(p.pRedIbs, 100);
    assert.equal(p.pRedCbs, 100);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('snapshot: produto CST 410 (imunidade — livros/jornais) — indGIbsCbs=false', async () => {
  const tenant = await criarTenantPresumido('09');
  try {
    const produto = await prisma.produto.create({
      data: { tenantId: tenant.id, ean: '9700000000009', nome: 'Livro', preco: 30, ncm: '49019900', cfop: '5102', cstIbsCbs: '410', cClassTrib: '410008' },
    });
    await backfillTenant(tenant.id);

    const snapshot = await pdvSnapshotService.montar(tenant.id);
    const [p] = snapshot.produtos;
    assert.equal(p.indGIbsCbs, false);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('snapshot: produto sem classificação fiscal (cadastro legado) — cstIbsCbs/cClassTrib e indicadores vêm todos null, sem lançar erro (snapshot é dump em lote, não emissão)', async () => {
  const tenant = await criarTenantPresumido('10');
  try {
    const produto = await prisma.produto.create({
      data: { tenantId: tenant.id, ean: '9700000000010', nome: 'Produto Legado', preco: 15 },
    });
    await backfillTenant(tenant.id);

    const snapshot = await pdvSnapshotService.montar(tenant.id);
    const [p] = snapshot.produtos;
    assert.equal(p.cstIbsCbs, null);
    assert.equal(p.cClassTrib, null);
    assert.equal(p.indGIbsCbs, null);
    assert.equal(p.indGRed, null);
    assert.equal(p.pRedIbs, null);
    assert.equal(p.pRedCbs, null);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('snapshot: tenant Simples Nacional (dispensado) — produto nem tem os indicadores resolvidos (nenhuma consulta ao catálogo é feita, emiteIbsCbs=false já basta)', async () => {
  const tenant = await criarTenant('11');
  try {
    const produto = await prisma.produto.create({
      data: { tenantId: tenant.id, ean: '9700000000011', nome: 'Produto Simples', preco: 15, cstIbsCbs: '000', cClassTrib: '000001' },
    });
    await backfillTenant(tenant.id);

    const snapshot = await pdvSnapshotService.montar(tenant.id);
    const [p] = snapshot.produtos;
    assert.equal(snapshot.fiscal.emiteIbsCbs, false);
    assert.equal(p.cstIbsCbs, '000', 'o código do produto ainda é repassado — só os indicadores resolvidos ficam null');
    assert.equal(p.indGIbsCbs, null);
    assert.equal(p.indGRed, null);
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
