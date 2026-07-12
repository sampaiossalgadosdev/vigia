/**
 * Arquivo: fiscal-schema.test.js
 * Responsabilidade: Confirma que os novos campos fiscais da Reforma 2026
 * em Produto, VendaItem e VendaPagamento salvam e recuperam corretamente.
 * Fase 1a: só schema — não testa cálculo de IBS/CBS (isso é Fase 1b).
 * Uso: node --test src/tests/fiscal-schema.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');

function cnpjTeste(sufixo) {
  return '96' + Date.now().toString().slice(-11) + sufixo;
}

test('Produto salva e recupera os campos fiscais novos (cstIbsCbs, cClassTrib, brstbs)', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Schema Fiscal', cnpj: cnpjTeste('01'), email: 'schema-fiscal@teste.com' },
  });
  let produto;
  try {
    produto = await prisma.produto.create({
      data: {
        tenantId: tenant.id, ean: '9600000000001', nome: 'Produto Fiscal Teste', preco: 15.5,
        ncm: '12345678', cfop: '5102',
        cstIbsCbs: '000', cClassTrib: '123456', brstbs: '10101',
      },
    });
    const lido = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(lido.ncm, '12345678', 'ncm existente continua funcionando');
    assert.equal(lido.cfop, '5102', 'cfop existente continua funcionando');
    assert.equal(lido.cstIbsCbs, '000');
    assert.equal(lido.cClassTrib, '123456');
    assert.equal(lido.brstbs, '10101');
  } finally {
    if (produto) await prisma.produto.delete({ where: { id: produto.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

test('VendaItem e VendaPagamento salvam e recuperam o snapshot fiscal e o placeholder de split payment', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Schema Fiscal Venda', cnpj: cnpjTeste('02'), email: 'schema-fiscal-venda@teste.com' },
  });
  let produto;
  let venda;
  try {
    produto = await prisma.produto.create({
      data: { tenantId: tenant.id, ean: '9600000000002', nome: 'Produto Venda Teste', preco: 10 },
    });
    venda = await prisma.venda.create({
      data: {
        tenantId: tenant.id, total: 10, subtotal: 10,
        itens: {
          create: [{
            produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10,
            valorIbs: 0.87, valorCbs: 0.13, cstIbsCbsAplicado: '000', cClassTribAplicado: '123456',
          }],
        },
        pagamentos: {
          create: [{ forma: 'pix', valor: 10, valorTributoSegregado: 1.0 }],
        },
      },
      include: { itens: true, pagamentos: true },
    });

    const item = venda.itens[0];
    assert.equal(Number(item.valorIbs), 0.87);
    assert.equal(Number(item.valorCbs), 0.13);
    assert.equal(item.cstIbsCbsAplicado, '000');
    assert.equal(item.cClassTribAplicado, '123456');

    const pagamento = venda.pagamentos[0];
    assert.equal(Number(pagamento.valorTributoSegregado), 1.0);

    // Recarrega do banco pra confirmar que persistiu de verdade, não só no retorno do create.
    const vendaRelida = await prisma.venda.findUnique({ where: { id: venda.id }, include: { itens: true, pagamentos: true } });
    assert.equal(Number(vendaRelida.itens[0].valorIbs), 0.87);
    assert.equal(Number(vendaRelida.pagamentos[0].valorTributoSegregado), 1.0);
  } finally {
    if (venda) {
      await prisma.vendaPagamento.deleteMany({ where: { vendaId: venda.id } });
      await prisma.vendaItem.deleteMany({ where: { vendaId: venda.id } });
      await prisma.venda.delete({ where: { id: venda.id } }).catch(() => {});
    }
    if (produto) await prisma.produto.delete({ where: { id: produto.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

after(async () => {
  await prisma.$disconnect();
});
