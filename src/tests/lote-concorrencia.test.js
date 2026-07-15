/**
 * Arquivo: lote-concorrencia.test.js
 * Responsabilidade: Regressão da trava (FOR UPDATE) + retry no consumo FIFO
 * de lote (lote.repository.listarAtivosParaConsumo, venda.service.registrar)
 * — corrige a corrida identificada por leitura de código: duas vendas
 * concorrentes do mesmo lote liam a mesma quantidade antes de qualquer
 * uma escrever, podendo estourar o lote.
 * Uso: node --test src/tests/lote-concorrencia.test.js
 * Depende de: DATABASE_URL válido em .env (usa o banco real via Prisma,
 * incluindo transações concorrentes reais via Promise.all — não mock).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const loteRepo = require('../repositories/lote.repository');
const vendaService = require('../services/venda.service');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Lock Lote ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `lock-lote-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.vendaItemLote.deleteMany({ where: { vendaItem: { venda: { tenantId } } } }).catch(() => {});
  await prisma.lote.deleteMany({ where: { estoqueProduto: { produto: { tenantId } } } }).catch(() => {});
  await prisma.movimentacaoEstoque.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.vendaPagamento.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.vendaItem.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.venda.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.estoqueProduto.deleteMany({ where: { produto: { tenantId } } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.deposito.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

function diasAPartirDeAgora(dias) {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}

test('listarAtivosParaConsumo: adquire FOR UPDATE — uma segunda transação concorrente ao mesmo lote espera até a primeira liberar, só então lê a quantidade', async () => {
  const tenant = await criarTenant('01');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9960000000001', nome: 'Produto Trava', preco: 10, controlaLote: true } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(10), quantidade: 10 } });

    const SEGURA_MS = 1200;
    let tx1PegouLock = false;

    const p1 = prisma.$transaction(async (tx) => {
      await loteRepo.listarAtivosParaConsumo(tx, estoqueProduto.id);
      tx1PegouLock = true;
      await new Promise((r) => setTimeout(r, SEGURA_MS));
    }, { timeout: 10000 });

    // Espera tx1 garantidamente já ter pego o lock antes de tx2 tentar.
    await new Promise((r) => { const check = () => (tx1PegouLock ? r() : setTimeout(check, 20)); check(); });

    const inicioTx2 = Date.now();
    await prisma.$transaction(async (tx) => {
      await loteRepo.listarAtivosParaConsumo(tx, estoqueProduto.id);
    }, { timeout: 10000 });
    const esperaTx2Ms = Date.now() - inicioTx2;

    await p1;

    assert.ok(esperaTx2Ms >= SEGURA_MS * 0.8, `tx2 deveria ter esperado perto de ${SEGURA_MS}ms (trava adquirida antes da leitura) — esperou só ${esperaTx2Ms}ms`);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('consumo multi-lote concorrente: vendas simultâneas consumindo os mesmos 2 lotes não travam em deadlock e o resultado final é consistente', async () => {
  const tenant = await criarTenant('02');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9960000000002', nome: 'Produto Multi Lote', preco: 10, controlaLote: true } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    // Cada lote sozinho não cobre uma venda de 6 — toda venda de 6 precisa
    // necessariamente consumir dos DOIS lotes (5 do mais antigo + 1 do novo).
    await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(5), quantidade: 5 } });
    await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(30), quantidade: 25 } });

    // 4 vendas concorrentes, cada uma pedindo 6 (obrigatoriamente multi-lote).
    const vendas = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        vendaService.registrar(
          tenant.id,
          { itens: [{ produtoId: produto.id, quantidade: 6 }], pagamentos: [{ forma: 'dinheiro', valor: 60 }] },
          { id: 'usuario-teste' },
          '127.0.0.1'
        )
      )
    );

    const sucesso = vendas.filter((v) => v.status === 'fulfilled');
    const falha = vendas.filter((v) => v.status === 'rejected');
    assert.equal(sucesso.length, 4, 'as 4 vendas cabem no total disponível (30) — nenhuma deveria falhar por estoque nem por deadlock/timeout');
    assert.equal(falha.length, 0, `nenhuma falha esperada; se houve, não deve ser timeout/deadlock: ${falha.map((f) => f.reason?.message).join(' | ')}`);

    const lotes = await prisma.lote.findMany({ where: { estoqueProdutoId: estoqueProduto.id }, orderBy: { dataValidade: 'asc' } });
    const totalRestante = lotes.reduce((soma, l) => soma + Number(l.quantidade), 0);
    assert.equal(totalRestante, 30 - 4 * 6, 'soma dos lotes deve refletir exatamente as 4 vendas de 6, sem sobra nem estouro');
    assert.ok(lotes.every((l) => Number(l.quantidade) >= 0), 'nenhum lote pode ficar negativo');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('retry automático: lock_timeout forçado (lote travado externamente pelo tempo todo) esgota as 3 tentativas e falha com mensagem distinta de estoque insuficiente', async () => {
  const tenant = await criarTenant('03');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9960000000003', nome: 'Produto Retry', preco: 10, controlaLote: true } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(10), quantidade: 10 } });

    let liberarLockExterno;
    const seguraLockExterno = new Promise((r) => { liberarLockExterno = r; });
    let externoPegouLock = false;
    const txExterna = prisma.$transaction(async (tx) => {
      await loteRepo.listarAtivosParaConsumo(tx, estoqueProduto.id);
      externoPegouLock = true;
      await seguraLockExterno; // só libera quando o teste mandar
    }, { timeout: 20000 });

    await new Promise((r) => { const check = () => (externoPegouLock ? r() : setTimeout(check, 20)); check(); });

    const inicio = Date.now();
    await assert.rejects(
      () => vendaService.registrar(
        tenant.id,
        { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 10 }] },
        { id: 'usuario-teste' },
        '127.0.0.1'
      ),
      (erro) => {
        assert.equal(erro.message, 'Sistema ocupado, tente novamente', 'mensagem de timeout esgotado deve ser distinta e não pode ser confundida com "Estoque em lote insuficiente"');
        assert.equal(erro.status, 503);
        return true;
      }
    );
    const duracaoMs = Date.now() - inicio;

    liberarLockExterno();
    await txExterna;

    // 3 tentativas × ~3s de lock_timeout + 2 intervalos de retry (150-300ms
    // cada) — duração total deve refletir MÚLTIPLAS tentativas, não uma só
    // (uma tentativa isolada ficaria perto de 3s, não de ~9s).
    assert.ok(duracaoMs >= 3000 * 2, `duração (${duracaoMs}ms) deveria refletir pelo menos 2 tentativas de lock_timeout consumidas antes de desistir, não uma só`);
    console.log(`[retry automático] duração total até desistir: ${duracaoMs}ms (esperado: perto de 3 × 3000ms + jitter dos retries)`);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('mensagem de erro: estoque insuficiente real (sem concorrência) é distinta de timeout esgotado', async () => {
  const tenant = await criarTenant('04');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9960000000004', nome: 'Produto Estoque Curto', preco: 10, controlaLote: true } });
    await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
    const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
    const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
    await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(10), quantidade: 2 } });

    await assert.rejects(
      () => vendaService.registrar(
        tenant.id,
        { itens: [{ produtoId: produto.id, quantidade: 5 }], pagamentos: [{ forma: 'dinheiro', valor: 50 }] },
        { id: 'usuario-teste' },
        '127.0.0.1'
      ),
      (erro) => {
        assert.match(erro.message, /Estoque em lote insuficiente/, 'estoque insuficiente real deve gerar a mensagem de negócio de sempre');
        assert.notEqual(erro.message, 'Sistema ocupado, tente novamente', 'as duas mensagens nunca podem ser iguais — operador precisa distinguir causa');
        assert.equal(erro.status, 422);
        return true;
      }
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

/**
 * TESTE MAIS IMPORTANTE — corrida real na escala do cliente (até 6 caixas
 * por loja). 6 transações de venda concorrentes de verdade (Promise.all,
 * banco real, sem mock), todas do MESMO lote, com quantidade suficiente
 * só para 3 delas. Roda em loop (5 iterações) pra reduzir chance de passar
 * por acaso devido a timing.
 * MEDIÇÃO: o tempo reportado por venda é o tempo total de
 * vendaService.registrar() (não só a espera pela trava isolada) — sob
 * contenção real, esse tempo é dominado pela espera de trava, já que a
 * seção computacional em si (leitura+cálculo+escrita local, sem rede) é
 * mínima; não há como medir só a espera da trava sem instrumentar o
 * código de produção só para teste, o que não foi feito de propósito.
 */
test('corrida real: 6 vendas concorrentes do mesmo lote (estoque só para 3) — nunca mais sucessos que o disponível, nenhuma trava indefinidamente, tempos medidos e reportados', async (t) => {
  const ITERACOES = 5;
  const CONCORRENTES = 6;
  const QUANTIDADE_DISPONIVEL = 3;

  for (let iteracao = 1; iteracao <= ITERACOES; iteracao++) {
    const tenant = await criarTenant(`corrida-${iteracao}`);
    try {
      const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: `996100000${iteracao.toString().padStart(4, '0')}`, nome: 'Produto Corrida', preco: 10, controlaLote: true } });
      await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
      const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenant.id);
      const estoqueProduto = await estoqueDepositoRepo.garantirEstoqueProduto(prisma, produto.id, deposito.id);
      await prisma.lote.create({ data: { estoqueProdutoId: estoqueProduto.id, dataValidade: diasAPartirDeAgora(10), quantidade: QUANTIDADE_DISPONIVEL } });

      const tempos = [];
      const resultados = await Promise.allSettled(
        Array.from({ length: CONCORRENTES }, (_, i) => {
          const inicio = Date.now();
          return vendaService
            .registrar(
              tenant.id,
              { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'dinheiro', valor: 10 }] },
              { id: 'usuario-teste' },
              '127.0.0.1'
            )
            .then((venda) => { tempos.push({ indice: i, ms: Date.now() - inicio, resultado: 'sucesso' }); return venda; })
            .catch((erro) => { tempos.push({ indice: i, ms: Date.now() - inicio, resultado: 'falha', mensagem: erro.message }); throw erro; });
        })
      );

      const sucesso = resultados.filter((r) => r.status === 'fulfilled');
      const falha = resultados.filter((r) => r.status === 'rejected');

      assert.ok(sucesso.length <= QUANTIDADE_DISPONIVEL, `iteração ${iteracao}: nunca mais sucessos (${sucesso.length}) do que o estoque real permite (${QUANTIDADE_DISPONIVEL})`);
      assert.equal(sucesso.length, QUANTIDADE_DISPONIVEL, `iteração ${iteracao}: exatamente ${QUANTIDADE_DISPONIVEL} deveriam suceder (nenhuma perdida por falso timeout)`);
      for (const f of falha) {
        assert.match(f.reason.message, /Estoque em lote insuficiente/, `iteração ${iteracao}: rejeição deve ser por estoque insuficiente, não confundida com timeout — foi: ${f.reason.message}`);
      }

      const loteFinal = await prisma.lote.findFirst({ where: { estoqueProdutoId: estoqueProduto.id } });
      assert.equal(Number(loteFinal.quantidade), 0, `iteração ${iteracao}: lote nunca pode ficar negativo — deve zerar exatamente (${QUANTIDADE_DISPONIVEL} vendidos)`);

      const maiorTempo = Math.max(...tempos.map((t2) => t2.ms));
      assert.ok(maiorTempo < 9500, `iteração ${iteracao}: nenhuma transação pode travar indefinidamente — maior tempo observado foi ${maiorTempo}ms, deveria resolver bem antes do teto de 3 tentativas × 3s`);

      tempos.sort((a, b) => a.indice - b.indice);
      t.diagnostic(`iteração ${iteracao}: tempos por transação (ms) — ${tempos.map((tm) => `#${tm.indice}:${tm.ms}ms(${tm.resultado})`).join(', ')}`);
      t.diagnostic(`iteração ${iteracao}: maior tempo=${maiorTempo}ms, menor tempo=${Math.min(...tempos.map((tm) => tm.ms))}ms`);
    } finally {
      await limparTenant(tenant.id);
    }
  }
});

after(async () => {
  await prisma.$disconnect();
});
