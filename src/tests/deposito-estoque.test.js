/**
 * Arquivo: deposito-estoque.test.js
 * Responsabilidade: Regressão da Fase 2a — modelo de Depósito e
 * permiteEstoqueNegativo por produto.
 * Cobre: backfill (migrarDepositos.backfillTenant), venda decrementando
 * corretamente o Depósito Principal (permitida e bloqueada), cancelamento de
 * venda devolvendo estoque, confirmação de NF-e incrementando estoque, e o
 * agregado Produto.estoqueQtd sempre sincronizado.
 * Uso: node --test src/tests/deposito-estoque.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const estoqueRepo = require('../repositories/estoque.repository');
const vendaService = require('../services/venda.service');
const depositoService = require('../services/deposito.service');
const { backfillTenant } = require('../scripts/migrarDepositos');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Depósito ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `deposito-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.movimentacaoEstoque.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.vendaPagamento.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.vendaItem.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.venda.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.nfeItem.deleteMany({ where: { nfe: { tenantId } } }).catch(() => {});
  await prisma.nfe.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.estoqueProduto.deleteMany({ where: { produto: { tenantId } } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.deposito.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('backfillTenant: cria Depósito Principal e EstoqueProduto batendo exatamente com o estoqueQtd anterior (positivo, zero e negativo)', async () => {
  const tenant = await criarTenant('01');
  try {
    const positivo = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9100000000001', nome: 'Positivo', preco: 10, estoqueQtd: 50 } });
    const zero = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9100000000002', nome: 'Zero', preco: 10, estoqueQtd: 0 } });
    const negativo = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9100000000003', nome: 'Negativo', preco: 10, estoqueQtd: -7 } });

    const resultado = await backfillTenant(tenant.id);
    assert.equal(resultado.depositoCriado, true);
    assert.equal(resultado.produtosProcessados, 3);
    assert.deepEqual(resultado.mismatches, []);

    const deposito = await prisma.deposito.findFirst({ where: { tenantId: tenant.id, principal: true } });
    assert.ok(deposito, 'Depósito Principal deve existir após o backfill');

    for (const [produto, esperado] of [[positivo, 50], [zero, 0], [negativo, -7]]) {
      const estoque = await prisma.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId: produto.id, depositoId: deposito.id } } });
      assert.equal(Number(estoque.quantidade), esperado, `EstoqueProduto de ${produto.nome} deve bater com o estoqueQtd anterior`);
      assert.equal(estoque.permiteEstoqueNegativo, true, 'backfill preserva o comportamento livre atual (permiteEstoqueNegativo=true)');

      const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
      assert.equal(Number(produtoDepois.estoqueQtd), esperado, 'Produto.estoqueQtd não deve mudar de valor após o backfill');
    }

    // Idempotência: rodar de novo não duplica nem altera nada.
    const segundaRodada = await backfillTenant(tenant.id);
    assert.equal(segundaRodada.depositoCriado, false);
    assert.deepEqual(segundaRodada.mismatches, []);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('venda: permiteEstoqueNegativo=true (padrão) permite vender além do estoque e registra auditoria', async () => {
  const tenant = await criarTenant('02');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9200000000001', nome: 'Produto Negativável', preco: 10, estoqueQtd: 5 } });
    await backfillTenant(tenant.id);
    const caixa = await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 8 }], pagamentos: [{ forma: 'dinheiro', valor: 80 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );
    assert.ok(venda.id);

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), -3, 'estoqueQtd deve ficar negativo (5 - 8) e sincronizado com o agregado');

    const deposito = await prisma.deposito.findFirst({ where: { tenantId: tenant.id, principal: true } });
    const estoque = await prisma.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId: produto.id, depositoId: deposito.id } } });
    assert.equal(Number(estoque.quantidade), -3, 'EstoqueProduto do Depósito Principal deve refletir o mesmo valor negativo');

    const auditorias = await prisma.auditoria.findMany({ where: { tenantId: tenant.id, acao: 'estoque_negativo', entidadeId: produto.id } });
    assert.equal(auditorias.length, 1, 'venda que fica negativa deve gerar 1 log de auditoria estoque_negativo (comportamento preservado)');
    assert.equal(caixa.id, (await prisma.caixa.findFirst({ where: { tenantId: tenant.id } })).id);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('venda: permiteEstoqueNegativo=false bloqueia a venda quando ficaria negativa, sem alterar o estoque', async () => {
  const tenant = await criarTenant('03');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9300000000001', nome: 'Produto Travado', preco: 10, estoqueQtd: 5 } });
    await backfillTenant(tenant.id);
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const deposito = await prisma.deposito.findFirst({ where: { tenantId: tenant.id, principal: true } });
    await estoqueDepositoRepo.definirPermiteNegativo(prisma, tenant.id, produto.id, false);

    await assert.rejects(
      () => vendaService.registrar(
        tenant.id,
        { itens: [{ produtoId: produto.id, quantidade: 8 }], pagamentos: [{ forma: 'dinheiro', valor: 80 }] },
        { id: 'usuario-teste' },
        '127.0.0.1'
      ),
      (erro) => {
        assert.match(erro.message, /Estoque insuficiente para Produto Travado, venda bloqueada/);
        return true;
      }
    );

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 5, 'estoqueQtd não deve mudar quando a venda é bloqueada');

    const estoque = await prisma.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId: produto.id, depositoId: deposito.id } } });
    assert.equal(Number(estoque.quantidade), 5, 'EstoqueProduto não deve mudar quando a venda é bloqueada');

    const vendasCriadas = await prisma.venda.count({ where: { tenantId: tenant.id } });
    assert.equal(vendasCriadas, 0, 'nenhuma venda deve ser persistida quando o estoque insuficiente bloqueia (rollback da transação)');

    // Venda dentro do limite (não ficaria negativa) continua permitida normalmente.
    const vendaOk = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 3 }], pagamentos: [{ forma: 'dinheiro', valor: 30 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );
    assert.ok(vendaOk.id);
    const produtoFinal = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoFinal.estoqueQtd), 2, 'venda dentro do estoque disponível continua permitida mesmo com permiteEstoqueNegativo=false');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('cancelamento de venda: devolve a quantidade ao Depósito Principal e resincroniza o agregado', async () => {
  const tenant = await criarTenant('04');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9400000000001', nome: 'Produto Cancelável', preco: 10, estoqueQtd: 10 } });
    await backfillTenant(tenant.id);
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 4 }], pagamentos: [{ forma: 'dinheiro', valor: 40 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );
    const apósVenda = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(apósVenda.estoqueQtd), 6);

    await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'teste de cancelamento', '127.0.0.1');

    const apósCancelamento = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(apósCancelamento.estoqueQtd), 10, 'cancelamento devolve a quantidade e Produto.estoqueQtd volta ao valor original');

    const deposito = await prisma.deposito.findFirst({ where: { tenantId: tenant.id, principal: true } });
    const estoque = await prisma.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId: produto.id, depositoId: deposito.id } } });
    assert.equal(Number(estoque.quantidade), 10, 'EstoqueProduto do Depósito Principal também volta ao valor original');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('confirmação de NF-e: incrementa o Depósito Principal e sincroniza Produto.estoqueQtd', async () => {
  const tenant = await criarTenant('05');
  try {
    const fornecedor = await prisma.fornecedor.create({ data: { tenantId: tenant.id, nome: 'Fornecedor Teste', cnpj: cnpjTeste('99') } });
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9500000000001', nome: 'Produto NFe', preco: 10, custoMedio: 5, estoqueQtd: 2 } });
    await backfillTenant(tenant.id);

    const nfe = await prisma.nfe.create({
      data: {
        tenantId: tenant.id,
        fornecedorId: fornecedor.id,
        numeroNfe: '1',
        chaveAcesso: `chave-teste-${Date.now()}`,
        dataEmissao: new Date(),
        valorTotal: 60,
        xmlOriginal: '<xml>teste</xml>',
        status: 'pendente',
        itens: {
          create: [{
            descricao: 'Item NFe', ean: produto.ean, unidade: 'UN',
            quantidade: 6, valorUnitario: 10, valorTotal: 60,
            status: 'ok', produtoId: produto.id, fatorConversao: 1,
          }],
        },
      },
      include: { itens: true },
    });

    await estoqueRepo.confirmarNfeTransacao(nfe, nfe.itens, 'usuario-teste');

    const produtoDepois = await prisma.produto.findUnique({ where: { id: produto.id } });
    assert.equal(Number(produtoDepois.estoqueQtd), 8, 'estoqueQtd deve incrementar (2 + 6) e ficar sincronizado com o agregado');

    const deposito = await prisma.deposito.findFirst({ where: { tenantId: tenant.id, principal: true } });
    const estoque = await prisma.estoqueProduto.findUnique({ where: { produtoId_depositoId: { produtoId: produto.id, depositoId: deposito.id } } });
    assert.equal(Number(estoque.quantidade), 8, 'EstoqueProduto do Depósito Principal deve refletir o mesmo incremento');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('DELETE depósito principal: bloqueado com 409, mas um depósito secundário pode ser excluído normalmente', async () => {
  const tenant = await criarTenant('06');
  try {
    await backfillTenant(tenant.id);
    const principal = await prisma.deposito.findFirst({ where: { tenantId: tenant.id, principal: true } });

    await assert.rejects(
      () => depositoService.remover(tenant.id, principal.id, { id: 'usuario-teste' }, '127.0.0.1'),
      (erro) => {
        assert.equal(erro.status, 409);
        assert.match(erro.message, /Não é possível excluir o depósito principal do tenant/);
        return true;
      }
    );
    const principalDepois = await prisma.deposito.findUnique({ where: { id: principal.id } });
    assert.equal(principalDepois.ativo, true, 'depósito principal não deve ser desativado pela tentativa bloqueada');

    // Contraste: um depósito secundário (não-principal) pode ser excluído normalmente —
    // prova que a trava é específica do principal, não um bloqueio geral do endpoint.
    const secundario = await estoqueDepositoRepo.criarDeposito(tenant.id, 'Depósito Secundário');
    const resultado = await depositoService.remover(tenant.id, secundario.id, { id: 'usuario-teste' }, '127.0.0.1');
    assert.equal(resultado.removido, true);
    const secundarioDepois = await prisma.deposito.findUnique({ where: { id: secundario.id } });
    assert.equal(secundarioDepois.ativo, false, 'depósito secundário deve ser desativado (soft delete) normalmente');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('PUT depósito principal: tentativa de alterar o campo principal é bloqueada, independente do valor enviado', async () => {
  const tenant = await criarTenant('07');
  try {
    await backfillTenant(tenant.id);
    const principal = await prisma.deposito.findFirst({ where: { tenantId: tenant.id, principal: true } });

    await assert.rejects(
      () => depositoService.atualizar(tenant.id, principal.id, { principal: false }, { id: 'usuario-teste' }, '127.0.0.1'),
      (erro) => {
        assert.equal(erro.status, 422);
        assert.match(erro.message, /Alterar qual depósito é o principal ainda não é suportado/);
        return true;
      }
    );
    const principalDepois = await prisma.deposito.findUnique({ where: { id: principal.id } });
    assert.equal(principalDepois.principal, true, 'principal não deve mudar quando a alteração é bloqueada');

    // Editar só o nome (sem mexer em `principal`) continua permitido normalmente.
    const atualizado = await depositoService.atualizar(tenant.id, principal.id, { nome: 'Depósito Principal Renomeado' }, { id: 'usuario-teste' }, '127.0.0.1');
    assert.equal(atualizado.nome, 'Depósito Principal Renomeado');
    assert.equal(atualizado.principal, true, 'renomear não deve afetar o campo principal');
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
