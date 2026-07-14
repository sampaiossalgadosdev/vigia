/**
 * Arquivo: venda-local-id.test.js
 * Responsabilidade: Regressão da correção do bug de dedup — Venda.localId
 * (identificador do client, Fase 3b) separado de Venda.chaveNfce (chave
 * fiscal real pós-SEFAZ). Antes desta correção, registrar() gravava
 * body.localId dentro de chaveNfce, e a emissão fiscal bem-sucedida
 * sobrescrevia chaveNfce com a chave real — quebrando buscarPorIdLocal
 * (que buscava em chaveNfce) assim que a NFC-e fosse emitida.
 * Uso: node --test src/tests/venda-local-id.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const vendaService = require('../services/venda.service');
const vendaRepo = require('../repositories/venda.repository');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste LocalId ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `localid-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.vendaPagamento.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.vendaItem.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.venda.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('migration: localId tem constraint @unique no BANCO — inserir duas vendas com o mesmo localId falha no nível do banco, não só da aplicação', async () => {
  const tenant = await criarTenant('00');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9900000000001', nome: 'Produto Unique', preco: 10 } });
    const localId = 'local-uuid-unique-00';

    await prisma.venda.create({
      data: {
        tenantId: tenant.id, subtotal: 10, total: 10, localId,
        itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
      },
    });

    await assert.rejects(
      () => prisma.venda.create({
        data: {
          tenantId: tenant.id, subtotal: 20, total: 20, localId,
          itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 20, custoUnitario: 5, subtotal: 20, total: 20 }] },
        },
      }),
      (erro) => {
        assert.equal(erro.code, 'P2002', 'deve ser erro de constraint única do Prisma/Postgres (violação de banco), não uma checagem de aplicação');
        return true;
      }
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

test('registrar(): body.localId é gravado em Venda.localId, nunca em Venda.chaveNfce', async () => {
  const tenant = await criarTenant('01');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9900000000002', nome: 'Produto Registrar', preco: 25 } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const localId = 'local-uuid-registrar-01';
    const venda = await vendaService.registrar(
      tenant.id,
      { localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 25 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );

    const registro = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(registro.localId, localId, 'localId deve ser gravado no campo próprio');
    assert.equal(registro.chaveNfce, null, 'chaveNfce NÃO deve receber o localId — deve ficar null até a emissão real');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('buscarPorIdLocal: encontra a venda pelo novo campo localId', async () => {
  const tenant = await criarTenant('02');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9900000000003', nome: 'Produto BuscarLocal', preco: 12 } });
    const localId = 'local-uuid-buscar-02';
    const venda = await prisma.venda.create({
      data: {
        tenantId: tenant.id, subtotal: 12, total: 12, localId,
        itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 12, custoUnitario: 6, subtotal: 12, total: 12 }] },
      },
    });

    const encontrada = await vendaRepo.buscarPorIdLocal(tenant.id, localId);
    assert.ok(encontrada, 'deve encontrar a venda pelo localId');
    assert.equal(encontrada.id, venda.id);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('REGRESSÃO DO BUG ORIGINAL: buscarPorIdLocal continua achando a venda pelo localId mesmo depois que chaveNfce foi sobrescrita pela emissão fiscal real', async () => {
  const tenant = await criarTenant('03');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9900000000004', nome: 'Produto Regressao', preco: 33 } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const localId = 'local-uuid-regressao-03';
    const resultados = await vendaService.sync(tenant.id, [
      { localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 33 }] },
    ]);
    assert.equal(resultados[0].status, 'ok');

    const criada = await prisma.venda.findFirst({ where: { tenantId: tenant.id, localId } });
    assert.ok(criada, 'venda deve ter sido criada pelo sync()');
    assert.equal(criada.chaveNfce, null, 'antes da emissão, chaveNfce deve estar vazia (não recebe o localId)');

    // Simula EXATAMENTE o que nfceEmissao.service.js faz ao emitir com
    // sucesso (linha 267): sobrescreve chaveNfce com a chave real de 44
    // dígitos. Isto é o passo que, antes da correção, quebrava o dedup.
    const chaveReal = '1'.repeat(44);
    await prisma.venda.update({ where: { id: criada.id }, data: { chaveNfce: chaveReal, emitidoEm: new Date() } });

    // O teste que prova a correção: buscarPorIdLocal com o MESMO localId
    // original ainda encontra a venda, porque localId nunca foi tocado.
    const encontradaDepoisDaEmissao = await vendaRepo.buscarPorIdLocal(tenant.id, localId);
    assert.ok(encontradaDepoisDaEmissao, 'buscarPorIdLocal deve continuar achando a venda pelo localId, mesmo após a emissão sobrescrever chaveNfce');
    assert.equal(encontradaDepoisDaEmissao.id, criada.id);
    assert.equal(encontradaDepoisDaEmissao.chaveNfce, chaveReal, 'chaveNfce deve ser a chave real — comportamento de emissão não muda');
    assert.equal(encontradaDepoisDaEmissao.localId, localId, 'localId deve permanecer intacto, nunca sobrescrito pela emissão');

    // Confirma também que um reenvio do mesmo localId (o cenário real do
    // bug: PDV reenviando por não ter recebido confirmação) seria
    // corretamente ignorado por duplicidade, e não criaria uma segunda venda.
    const resultadosReenvio = await vendaService.sync(tenant.id, [
      { localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 33 }] },
    ]);
    assert.equal(resultadosReenvio[0].status, 'ok');
    assert.match(resultadosReenvio[0].mensagem, /Ignorada por duplicidade/);
    const totalVendas = await prisma.venda.count({ where: { tenantId: tenant.id, localId } });
    assert.equal(totalVendas, 1, 'o reenvio não pode ter criado uma segunda venda — este é o bug original corrigido');
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
