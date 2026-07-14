/**
 * Arquivo: venda-data-venda.test.js
 * Responsabilidade: Regressão da separação criadoEm (INSERT) / dataVenda
 * (momento real da venda) — migration, registrar()/sync() e todas as
 * leituras que a Tarefa 4 corrigiu pra usar dataVenda em vez de criadoEm
 * (dashboard, relatórios, listagem/fechamento de venda, urgência da fila
 * de emissão — esta última coberta em filaEmissaoNfce.test.js).
 * Uso: node --test src/tests/venda-data-venda.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const vendaService = require('../services/venda.service');
const dashboardRepo = require('../repositories/dashboard.repository');
const relatorioRepo = require('../repositories/relatorio.repository');
const relatorioService = require('../services/relatorio.service');
const vendaRepo = require('../repositories/venda.repository');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste DataVenda ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `datavenda-${sufixo}-${Date.now()}@teste.com` },
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

test('migration: sem o backfill explícito o DEFAULT erraria; o UPDATE de backfill da migration corrige dataVenda para bater com criadoEm', async () => {
  const tenant = await criarTenant('01');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9800000000001', nome: 'Produto Backfill', preco: 10 } });
    const criadoEmAntigo = new Date('2026-01-01T10:00:00Z');
    // Simula uma linha "legada": só criadoEm é controlado; dataVenda fica
    // pro DEFAULT CURRENT_TIMESTAMP do banco, como ficaria sem o backfill.
    const venda = await prisma.venda.create({
      data: {
        tenantId: tenant.id, subtotal: 10, total: 10, criadoEm: criadoEmAntigo,
        itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
      },
    });
    assert.notEqual(venda.dataVenda.toISOString(), venda.criadoEm.toISOString(), 'sem backfill, dataVenda ficaria com "agora" (DEFAULT), divergindo do criadoEm antigo');

    // Mesmo UPDATE de backfill usado na migration 20260714000319_venda_data_venda.
    await prisma.$executeRaw`UPDATE "Venda" SET "dataVenda" = "criadoEm" WHERE id = ${venda.id}`;

    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.dataVenda.toISOString(), depois.criadoEm.toISOString(), 'após o backfill, dataVenda deve bater exatamente com criadoEm');
    assert.equal(depois.dataVenda.toISOString(), criadoEmAntigo.toISOString());
  } finally {
    await limparTenant(tenant.id);
  }
});

test('registrar() sem dataVenda em opções (fluxo online normal): dataVenda gravado é ~now(), igual a criadoEm — sem regressão', async () => {
  const tenant = await criarTenant('02');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9800000000002', nome: 'Produto Online', preco: 15 } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const antes = Date.now();
    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 15 }] },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );
    const depois = Date.now();

    const registro = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.ok(registro.dataVenda.getTime() >= antes - 1000 && registro.dataVenda.getTime() <= depois + 1000, 'dataVenda deve ser ~now()');
    assert.equal(registro.dataVenda.toISOString(), registro.criadoEm.toISOString(), 'no fluxo online, dataVenda e criadoEm devem coincidir (mesmo now())');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('registrar() (mesmo caminho de POST /api/vendas, sem passar opções): dataVenda enviado no body é ignorado — segurança contra retroagir venda online', async () => {
  const tenant = await criarTenant('03');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9800000000003', nome: 'Produto Seguranca', preco: 20 } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const dataVendaMaliciosa = new Date('2020-01-01T00:00:00Z');
    const antes = Date.now();
    // Nota: SEM 5º argumento (opcoes) — exatamente como venda.controller.registrar chama.
    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 20 }], dataVenda: dataVendaMaliciosa },
      { id: 'usuario-teste' },
      '127.0.0.1'
    );

    const registro = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.ok(registro.dataVenda.getTime() >= antes - 1000, 'dataVenda deve ser ~agora, ignorando o valor malicioso enviado no body');
    assert.notEqual(registro.dataVenda.toISOString(), dataVendaMaliciosa.toISOString());
  } finally {
    await limparTenant(tenant.id);
  }
});

test('sync(): dataVenda explícito no body é usado; criadoEm continua sendo o momento real do INSERT (divergem de propósito, simulando sync tardio)', async () => {
  const tenant = await criarTenant('04');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9800000000004', nome: 'Produto Sync', preco: 30 } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const dataVendaAntiga = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const antesInsert = Date.now();
    const localId = 'local-uuid-sync-04';
    const resultados = await vendaService.sync(tenant.id, [
      { localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 30 }], dataVenda: dataVendaAntiga },
    ]);

    assert.equal(resultados[0].status, 'ok');
    const venda = await prisma.venda.findFirst({ where: { tenantId: tenant.id, chaveNfce: localId } });
    assert.ok(venda, 'venda deve ter sido persistida');
    assert.equal(venda.dataVenda.toISOString(), dataVendaAntiga.toISOString(), 'dataVenda deve ser exatamente o valor enviado no sync');
    assert.ok(venda.criadoEm.getTime() >= antesInsert - 1000, 'criadoEm deve ser o momento real do INSERT (agora), não o dataVenda antigo');
    assert.notEqual(venda.criadoEm.toISOString(), venda.dataVenda.toISOString(), 'devem divergir de propósito nesta simulação de sync tardio');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('sync(): dataVenda no futuro (além da tolerância de relógio) é rejeitado com erro claro, sem persistir a venda', async () => {
  const tenant = await criarTenant('05');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9800000000005', nome: 'Produto Futuro', preco: 40 } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });

    const futuro = new Date(Date.now() + 60 * 60 * 1000); // 1h no futuro — além da tolerância de 5min
    const localId = 'local-uuid-sync-05';
    const resultados = await vendaService.sync(tenant.id, [
      { localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 40 }], dataVenda: futuro },
    ]);

    assert.equal(resultados[0].status, 'erro');
    assert.match(resultados[0].mensagem, /dataVenda não pode estar no futuro/);
    const venda = await prisma.venda.findFirst({ where: { tenantId: tenant.id, chaveNfce: localId } });
    assert.equal(venda, null, 'nenhuma venda deve ser persistida quando dataVenda é rejeitada');
  } finally {
    await limparTenant(tenant.id);
  }
});

/**
 * Fixture compartilhada pelos testes de leitura (Tarefa 4): duas vendas no
 * mesmo tenant, uma com dataVenda DENTRO do período de busca e criadoEm
 * FORA (simula sync tardio de uma venda antiga), outra com dataVenda FORA
 * e criadoEm DENTRO (a "armadilha" — só apareceria se o código ainda lesse
 * criadoEm por engano). Provar que só a primeira aparece nas leituras
 * corrigidas prova que a leitura usa dataVenda de fato.
 */
async function criarFixtureDentroFora(sufixo) {
  const tenant = await criarTenant(sufixo);
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: `981${sufixo}0000001`, nome: 'Produto Fixture', preco: 111 } });
  const inicio = new Date('2026-03-10T00:00:00Z');
  const fim = new Date('2026-03-10T23:59:59Z');

  const dentro = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 111, total: 111, status: 'concluida',
      dataVenda: new Date('2026-03-10T15:00:00Z'), // dentro do período
      criadoEm: new Date('2026-05-01T09:00:00Z'), // fora do período (sync tardio)
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 111, custoUnitario: 50, subtotal: 111, total: 111 }] },
      pagamentos: { create: [{ forma: 'pix', valor: 111 }] },
    },
  });
  const fora = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 222, total: 222, status: 'concluida',
      dataVenda: new Date('2026-04-15T15:00:00Z'), // fora do período
      criadoEm: new Date('2026-03-10T09:00:00Z'), // dentro do período (armadilha)
      itens: { create: [{ produtoId: produto.id, quantidade: 2, precoUnitario: 111, custoUnitario: 50, subtotal: 222, total: 222 }] },
      pagamentos: { create: [{ forma: 'credito', valor: 222 }] },
    },
  });

  return { tenant, produto, inicio, fim, dentro, fora };
}

test('dashboard.resumoVendas: usa dataVenda — soma e contagem refletem só a venda cujo dataVenda cai no período', async () => {
  const { tenant, inicio, fim } = await criarFixtureDentroFora('06');
  try {
    const r = await dashboardRepo.resumoVendas(tenant.id, inicio, fim);
    assert.equal(r.vendas, 1, 'só a venda com dataVenda dentro do período deve contar');
    assert.equal(r.total, 111, 'total deve ser só o da venda "dentro" (111), não incluir a "fora" (222)');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('dashboard.vendasPorGrupo: usa dataVenda — valor do grupo reflete só a venda dentro do período', async () => {
  const { tenant, inicio, fim } = await criarFixtureDentroFora('07');
  try {
    const grupos = await dashboardRepo.vendasPorGrupo(tenant.id, inicio, fim);
    const totalGrupos = grupos.reduce((s, g) => s + Number(g.valor), 0);
    assert.equal(totalGrupos, 111, 'soma dos grupos deve refletir só a venda "dentro" do período (111)');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('dashboard.vendasPorFormaPagamento: usa dataVenda — só a forma de pagamento da venda dentro do período aparece', async () => {
  const { tenant, inicio, fim } = await criarFixtureDentroFora('08');
  try {
    const formas = await dashboardRepo.vendasPorFormaPagamento(tenant.id, inicio, fim);
    assert.equal(formas.length, 1, 'só uma forma de pagamento deve aparecer (a da venda "dentro")');
    assert.equal(formas[0].forma, 'pix');
    assert.equal(Number(formas[0].valor), 111);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('dashboard.topProdutos: usa dataVenda — quantidade reflete só o item da venda dentro do período', async () => {
  const { tenant, inicio, fim } = await criarFixtureDentroFora('09');
  try {
    const produtos = await dashboardRepo.topProdutos(tenant.id, inicio, fim);
    assert.equal(produtos.length, 1);
    assert.equal(Number(produtos[0].quantidade), 1, 'quantidade deve ser só 1 unidade (venda "dentro"), não 3 (1+2 somando a "fora")');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('dashboard.topVendedores: usa dataVenda — valor reflete só a venda dentro do período', async () => {
  const { tenant, inicio, fim } = await criarFixtureDentroFora('10');
  try {
    const vendedores = await dashboardRepo.topVendedores(tenant.id, inicio, fim);
    assert.equal(vendedores.length, 1);
    assert.equal(Number(vendedores[0].valor), 111);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('dashboard.vendasPorDia/PorMes/PorDiaSemana/PorHora: usam dataVenda — soma total das faixas é só a venda dentro do período', async () => {
  const { tenant, inicio, fim } = await criarFixtureDentroFora('11');
  try {
    const [porDia, porMes, porDiaSemana, porHora] = await Promise.all([
      dashboardRepo.vendasPorDia(tenant.id, inicio, fim),
      dashboardRepo.vendasPorMes(tenant.id, inicio, fim),
      dashboardRepo.vendasPorDiaSemana(tenant.id, inicio, fim),
      dashboardRepo.vendasPorHora(tenant.id, inicio, fim),
    ]);
    for (const [nome, linhas] of [['porDia', porDia], ['porMes', porMes], ['porDiaSemana', porDiaSemana], ['porHora', porHora]]) {
      const totalVendas = linhas.reduce((s, l) => s + Number(l.vendas), 0);
      const totalValor = linhas.reduce((s, l) => s + Number(l.valor), 0);
      assert.equal(totalVendas, 1, `${nome}: deve contar só 1 venda (a "dentro" do período)`);
      assert.equal(totalValor, 111, `${nome}: valor total deve ser só 111 (a "dentro"), não incluir a "fora" (222)`);
    }
  } finally {
    await limparTenant(tenant.id);
  }
});

test('relatorio.repository.vendasDia: usa dataVenda — retorna só a venda dentro do período', async () => {
  const { tenant, inicio, fim, dentro, fora } = await criarFixtureDentroFora('12');
  try {
    const vendas = await relatorioRepo.vendasDia(tenant.id, inicio, fim);
    assert.equal(vendas.length, 1);
    assert.equal(vendas[0].id, dentro.id);
    assert.ok(!vendas.some((v) => v.id === fora.id));
  } finally {
    await limparTenant(tenant.id);
  }
});

test('relatorio.repository.produtosMaisVendidos: usa dataVenda — quantidade reflete só a venda dentro do período', async () => {
  const { tenant, inicio, fim } = await criarFixtureDentroFora('13');
  try {
    const produtos = await relatorioRepo.produtosMaisVendidos(tenant.id, inicio, fim);
    assert.equal(produtos.length, 1);
    assert.equal(produtos[0].qtd, 1);
    assert.equal(produtos[0].receita, 111);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('relatorio.repository.margem: usa dataVenda — receita/custo refletem só a venda dentro do período', async () => {
  const { tenant, inicio, fim } = await criarFixtureDentroFora('14');
  try {
    const margens = await relatorioRepo.margem(tenant.id, inicio, fim);
    assert.equal(margens.length, 1);
    assert.equal(margens[0].receita, 111);
    assert.equal(margens[0].custo, 50);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('relatorio.service.vendasDia: bucket por hora usa dataVenda, não criadoEm', async () => {
  const { tenant } = await criarFixtureDentroFora('15');
  try {
    const query = { inicio: '2026-03-10', fim: '2026-03-10T23:59:59.999Z' };
    const resultado = await relatorioService.vendasDia(tenant.id, query);
    assert.equal(resultado.total, 1, 'só a venda com dataVenda no dia 10/03 deve entrar no relatório do dia');
    const horaEsperada = new Date('2026-03-10T15:00:00Z').getHours();
    assert.equal(resultado.porHora[horaEsperada].qtd, 1, 'a venda deve cair no bucket da hora do seu dataVenda (15h UTC), não do criadoEm (09h UTC)');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('venda.repository.listar: filtro de período usa dataVenda — só a venda dentro do período aparece na listagem', async () => {
  const { tenant, inicio, fim, dentro, fora } = await criarFixtureDentroFora('16');
  try {
    const { items, total } = await vendaRepo.listar(tenant.id, { inicio: inicio.toISOString(), fim: fim.toISOString() }, { skip: 0, take: 20 });
    assert.equal(total, 1);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, dentro.id);
    assert.ok(!items.some((v) => v.id === fora.id));
  } finally {
    await limparTenant(tenant.id);
  }
});

test('venda.repository.listarResumoDiario: filtro de período usa dataVenda — fechamento de caixa reflete só a venda dentro do período', async () => {
  const { tenant, inicio, fim, dentro, fora } = await criarFixtureDentroFora('17');
  try {
    const vendas = await vendaRepo.listarResumoDiario(tenant.id, inicio, fim);
    assert.equal(vendas.length, 1);
    assert.equal(vendas[0].id, dentro.id);
    assert.ok(!vendas.some((v) => v.id === fora.id));
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
