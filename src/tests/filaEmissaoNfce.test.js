/**
 * Arquivo: filaEmissaoNfce.test.js
 * Responsabilidade: Regressão da fila assíncrona de emissão de NFC-e
 * (complemento Fase 1c/3) — venda.service.registrar só marca
 * statusEmissaoFiscal (sem chamar a SEFAZ), processarFilaEmissao processa
 * em lote (sucesso/rejeição/falha temporária, uma falha não trava as
 * outras), e calcularUrgenciaEmissao/calcularPrazoLimiteContingencia
 * (Ajuste SINIEF 19/2016 — só cálculo de visibilidade, nenhuma ação
 * automática).
 * Uso: node --test src/tests/filaEmissaoNfce.test.js
 * Depende de: DATABASE_URL válido em .env. SEFAZ_MOCK=true (sem rede real).
 */
process.env.SEFAZ_MOCK = 'true';
require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const vendaService = require('../services/venda.service');
const filaService = require('../services/filaEmissaoNfce.service');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenantCompleto(sufixo) {
  return prisma.tenant.create({
    data: {
      nome: 'Teste Fila Emissao ' + sufixo, cnpj: cnpjTeste(sufixo), email: `fila-emissao-${sufixo}@teste.com`,
      uf: 'PR', regimeTributario: 'real', ambienteFiscal: 'homologacao',
      certificadoPfx: criptografar(Buffer.from('conteudo-fake-do-pfx')),
      certificadoSenha: criptografarTexto('senha-fake'),
      cnae: '4711-3/02', inscricaoEstadual: '123456789',
      cscProducao: criptografarTexto('csc-fake-prod'), cscProducaoId: '1',
      cscHomologacao: criptografarTexto('csc-fake-hom'), cscHomologacaoId: '1',
      logradouro: 'Rua Teste', numero: '100', bairro: 'Centro', municipio: 'Curitiba',
      codigoMunicipioIbge: '4106902', cep: '80000-000',
    },
  });
}

async function criarTenantIncompleto(sufixo) {
  return prisma.tenant.create({
    data: { nome: 'Teste Fila Incompleto ' + sufixo, cnpj: cnpjTeste(sufixo), email: `fila-incompleto-${sufixo}@teste.com` },
  });
}

async function criarProduto(tenantId, sufixo) {
  return prisma.produto.create({
    data: { tenantId, ean: '98' + Date.now().toString().slice(-11) + sufixo, nome: 'Produto Fila ' + sufixo, preco: 20, ncm: '10063011', cfop: '5102' },
  });
}

/**
 * Venda criada direto no banco (não via vendaService.registrar) — pra
 * testes que só precisam de uma Venda 'pendente' já pronta, com criadoEm
 * e/ou dataVenda controlados. dataVenda default = criadoEm (mesmo valor)
 * quando não informado separadamente, pra não quebrar os testes que só
 * controlam a ordem via criadoEm e não se importam com a distinção.
 */
async function criarVendaPendenteDireto(tenantId, produtoId, { criadoEm, dataVenda } = {}) {
  return prisma.venda.create({
    data: {
      tenantId, subtotal: 20, total: 20, chaveNfce: 'localid-' + Date.now() + Math.random(),
      statusEmissaoFiscal: 'pendente', criadoEm, dataVenda: dataVenda ?? criadoEm,
      itens: { create: [{ produtoId, quantidade: 1, precoUnitario: 20, custoUnitario: 10, subtotal: 20, total: 20 }] },
      pagamentos: { create: [{ forma: 'pix', valor: 20 }] },
    },
  });
}

async function limpar(tenantId, vendaIds = [], produtoIds = []) {
  for (const vendaId of vendaIds) {
    await prisma.vendaPagamento.deleteMany({ where: { vendaId } }).catch(() => {});
    await prisma.vendaItem.deleteMany({ where: { vendaId } }).catch(() => {});
    await prisma.venda.delete({ where: { id: vendaId } }).catch(() => {});
  }
  for (const produtoId of produtoIds) await prisma.produto.delete({ where: { id: produtoId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

// "Esquenta" a conexão com o banco antes do primeiro teste — evita que o
// custo de handshake da PRIMEIRA query do processo (latência de rede até
// o Postgres remoto) seja contabilizado dentro do timeout de 5s da
// primeira transação interativa (venda.service.registrar), o que não tem
// relação nenhuma com a lógica sendo testada aqui.
before(async () => {
  await prisma.tenant.findFirst();
});

test('registrar(): tenant com configuração fiscal completa marca statusEmissaoFiscal=pendente, sem chamar a SEFAZ', async () => {
  const tenant = await criarTenantCompleto('01');
  const produto = await criarProduto(tenant.id, '01');
  const caixa = await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  let venda;
  try {
    venda = await vendaService.registrar(
      tenant.id, { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 20 }] },
      { id: 'usuario-teste' }, '127.0.0.1'
    );
    assert.equal(venda.statusEmissaoFiscal, 'pendente');
    // Prova de que não houve chamada síncrona à SEFAZ: nenhum campo de
    // autorização foi preenchido — quem preenche é só o worker depois.
    assert.equal(venda.emitidoEm, null);
    assert.equal(venda.protocoloAutorizacao, null);
    assert.equal(venda.xmlNfce, null);
    assert.doesNotMatch(venda.chaveNfce || '', /^\d{44}$/, 'chaveNfce não pode virar a chave real de 44 dígitos aqui — isso só acontece no worker');
  } finally {
    await limpar(tenant.id, venda ? [venda.id] : [], [produto.id]);
    await prisma.caixa.delete({ where: { id: caixa.id } }).catch(() => {});
  }
});

test('registrar(): tenant com configuração fiscal incompleta marca statusEmissaoFiscal=nao_aplicavel (não entra na fila)', async () => {
  const tenant = await criarTenantIncompleto('02');
  const produto = await criarProduto(tenant.id, '02');
  const caixa = await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  let venda;
  try {
    venda = await vendaService.registrar(
      tenant.id, { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 20 }] },
      { id: 'usuario-teste' }, '127.0.0.1'
    );
    assert.equal(venda.statusEmissaoFiscal, 'nao_aplicavel');

    const pendentes = await prisma.venda.count({ where: { tenantId: tenant.id, statusEmissaoFiscal: 'pendente' } });
    assert.equal(pendentes, 0, 'venda de tenant sem config completa não deve entrar na fila');
  } finally {
    await limpar(tenant.id, venda ? [venda.id] : [], [produto.id]);
    await prisma.caixa.delete({ where: { id: caixa.id } }).catch(() => {});
  }
});

test('processarFilaEmissao: sucesso (mock) marca statusEmissaoFiscal=emitido', async () => {
  const tenant = await criarTenantCompleto('03');
  const produto = await criarProduto(tenant.id, '03');
  const venda = await criarVendaPendenteDireto(tenant.id, produto.id);
  try {
    const resumo = await filaService.processarFilaEmissao();
    assert.ok(resumo.emitidas >= 1);

    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.statusEmissaoFiscal, 'emitido');
    assert.match(depois.chaveNfce, /^\d{44}$/);
    assert.ok(depois.xmlNfce);
  } finally {
    await limpar(tenant.id, [venda.id], [produto.id]);
  }
});

test('processarFilaEmissao: rejeição de conteúdo marca statusEmissaoFiscal=rejeitado, sem agendar nova tentativa', async () => {
  const tenant = await criarTenantCompleto('04');
  const produto = await criarProduto(tenant.id, '04');
  const venda = await criarVendaPendenteDireto(tenant.id, produto.id);
  try {
    const chamarRejeitando = async () => ({ cStat: '204', xMotivo: 'Rejeição: duplicidade de NF-e' });
    const resumo = await filaService.processarFilaEmissao({ chamarWebservice: chamarRejeitando });
    assert.equal(resumo.rejeitadas, 1);
    assert.equal(resumo.emitidas, 0);
    assert.equal(resumo.falhaTemporaria, 0);

    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.statusEmissaoFiscal, 'rejeitado');
    assert.equal(depois.tentativasEmissao, 1);
    assert.equal(depois.proximaTentativaEm, null, 'rejeição de conteúdo não agenda retry automático');
  } finally {
    await limpar(tenant.id, [venda.id], [produto.id]);
  }
});

test('processarFilaEmissao: falha de conexão marca falha_temporaria com proximaTentativaEm correto, com exatamente 1 chamada de rede (sem contingência SVC)', async () => {
  const tenant = await criarTenantCompleto('05');
  const produto = await criarProduto(tenant.id, '05');
  const venda = await criarVendaPendenteDireto(tenant.id, produto.id);
  try {
    let chamadas = 0;
    const chamarSempreFalha = async () => { chamadas += 1; throw new Error('ECONNREFUSED (simulado)'); };
    const antes = Date.now();
    const resumo = await filaService.processarFilaEmissao({ chamarWebservice: chamarSempreFalha });
    assert.equal(resumo.falhaTemporaria, 1);
    assert.equal(resumo.emitidas, 0);
    assert.equal(resumo.rejeitadas, 0);
    assert.equal(chamadas, 1, 'não deve tentar nenhum endpoint alternativo (contingência SVC removida) -- a fila tenta de novo só na próxima passada');

    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.statusEmissaoFiscal, 'falha_temporaria');
    assert.equal(depois.tentativasEmissao, 1);
    assert.ok(depois.proximaTentativaEm);
    const minutosAgendados = (new Date(depois.proximaTentativaEm).getTime() - antes) / 60000;
    assert.ok(Math.abs(minutosAgendados - filaService.INTERVALO_RETRY_MINUTOS) < 0.5, `proximaTentativaEm deve ser ~${filaService.INTERVALO_RETRY_MINUTOS} minutos à frente, foi ${minutosAgendados}`);
  } finally {
    await limpar(tenant.id, [venda.id], [produto.id]);
  }
});

test('processarFilaEmissao: processa múltiplas vendas na mesma chamada — uma falhar não impede as outras', async () => {
  const tenant = await criarTenantCompleto('06');
  const produtoA = await criarProduto(tenant.id, '06a');
  const produtoB = await criarProduto(tenant.id, '06b');
  const produtoC = await criarProduto(tenant.id, '06c');
  const base = Date.now() - 10000;
  const vendaA = await criarVendaPendenteDireto(tenant.id, produtoA.id, { criadoEm: new Date(base) });
  const vendaB = await criarVendaPendenteDireto(tenant.id, produtoB.id, { criadoEm: new Date(base + 1000) });
  const vendaC = await criarVendaPendenteDireto(tenant.id, produtoC.id, { criadoEm: new Date(base + 2000) });
  try {
    // Sem contingência SVC, cada venda faz UMA chamada só — a do meio
    // (chamada 2) falha, as outras (1 e 3) têm sucesso normal.
    let chamada = 0;
    const chamarComFalhaNaSegunda = async () => {
      chamada += 1;
      if (chamada === 2) throw new Error('ECONNREFUSED (simulado) — falha proposital na segunda venda');
      return { cStat: '100', xMotivo: 'Autorizado o uso da NF-e (MOCK)', protocolo: 'MOCK' + chamada };
    };

    const resumo = await filaService.processarFilaEmissao({ chamarWebservice: chamarComFalhaNaSegunda });
    assert.equal(resumo.total, 3);
    assert.equal(resumo.emitidas, 2);
    assert.equal(resumo.falhaTemporaria, 1);

    const [depoisA, depoisB, depoisC] = await Promise.all([
      prisma.venda.findUnique({ where: { id: vendaA.id } }),
      prisma.venda.findUnique({ where: { id: vendaB.id } }),
      prisma.venda.findUnique({ where: { id: vendaC.id } }),
    ]);
    assert.equal(depoisA.statusEmissaoFiscal, 'emitido', 'primeira venda (ordem por dataVenda, que aqui coincide com criadoEm) deve ter sido processada com sucesso');
    assert.equal(depoisB.statusEmissaoFiscal, 'falha_temporaria', 'segunda venda é a que falha, propositalmente');
    assert.equal(depoisC.statusEmissaoFiscal, 'emitido', 'terceira venda deve ser processada normalmente, sem ser afetada pela falha da segunda');
  } finally {
    await limpar(tenant.id, [vendaA.id, vendaB.id, vendaC.id], [produtoA.id, produtoB.id, produtoC.id]);
  }
});

test('buscarPendentes (via processarFilaEmissao): ordena por dataVenda, não criadoEm — venda com dataVenda mais antigo é processada primeiro mesmo com criadoEm mais recente', async () => {
  const tenant = await criarTenantCompleto('09');
  const produtoAntiga = await criarProduto(tenant.id, '09a');
  const produtoRecente = await criarProduto(tenant.id, '09b');

  const antigo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const recente = new Date();
  // vendaAntiga: dataVenda de 5 dias atrás mas criadoEm de agora (simula
  // sync tardio) — deve furar a fila e ser processada 1º.
  const vendaAntiga = await criarVendaPendenteDireto(tenant.id, produtoAntiga.id, { criadoEm: recente, dataVenda: antigo });
  // vendaRecente: dataVenda de agora mas criadoEm de 5 dias atrás (cenário
  // artificial só para provar que a ordenação ignora criadoEm) — deve ser
  // processada 2º.
  const vendaRecente = await criarVendaPendenteDireto(tenant.id, produtoRecente.id, { criadoEm: antigo, dataVenda: recente });

  try {
    let chamada = 0;
    const falharNaPrimeira = async () => {
      chamada += 1;
      if (chamada === 1) throw new Error('ECONNREFUSED (simulado) — falha proposital na 1ª chamada');
      return { cStat: '100', xMotivo: 'Autorizado o uso da NF-e (MOCK)', protocolo: 'MOCK' + chamada };
    };

    const resumo = await filaService.processarFilaEmissao({ chamarWebservice: falharNaPrimeira });
    assert.equal(resumo.total, 2);

    const [depoisAntiga, depoisRecente] = await Promise.all([
      prisma.venda.findUnique({ where: { id: vendaAntiga.id } }),
      prisma.venda.findUnique({ where: { id: vendaRecente.id } }),
    ]);
    assert.equal(depoisAntiga.statusEmissaoFiscal, 'falha_temporaria', 'venda com dataVenda mais antigo deve ser a 1ª processada (a que falha propositalmente)');
    assert.equal(depoisRecente.statusEmissaoFiscal, 'emitido', 'venda com dataVenda mais recente deve ser processada depois, com sucesso');
  } finally {
    await limpar(tenant.id, [vendaAntiga.id, vendaRecente.id], [produtoAntiga.id, produtoRecente.id]);
  }
});

test('calcularUrgenciaEmissao: venda emitida há 2h (mesmo dia útil) → tranquilo', () => {
  const dataEmissaoVenda = new Date('2026-07-13T08:00:00-03:00'); // segunda-feira
  const agora = new Date('2026-07-13T10:00:00-03:00'); // 2h depois, mesmo dia
  const { urgencia, horasRestantes } = filaService.calcularUrgenciaEmissao(dataEmissaoVenda, agora);
  assert.equal(urgencia, 'tranquilo');
  assert.ok(horasRestantes > 12);
});

test('calcularUrgenciaEmissao: 10h antes do prazo-limite → atencao', () => {
  const dataEmissaoVenda = new Date('2026-07-13T08:00:00-03:00'); // segunda-feira → prazo = terça 23:59:59.999
  const prazoLimite = filaService.calcularPrazoLimiteContingencia(dataEmissaoVenda);
  const agora = new Date(prazoLimite.getTime() - 10 * 60 * 60 * 1000);
  const { urgencia, horasRestantes } = filaService.calcularUrgenciaEmissao(dataEmissaoVenda, agora);
  assert.equal(urgencia, 'atencao');
  assert.ok(horasRestantes >= 4 && horasRestantes <= 12);
});

test('calcularUrgenciaEmissao: prazo já vencido → urgente, com horas negativas', () => {
  const dataEmissaoVenda = new Date('2026-07-13T08:00:00-03:00');
  const prazoLimite = filaService.calcularPrazoLimiteContingencia(dataEmissaoVenda);
  const agora = new Date(prazoLimite.getTime() + 5 * 60 * 60 * 1000); // 5h depois do prazo
  const { urgencia, horasRestantes } = filaService.calcularUrgenciaEmissao(dataEmissaoVenda, agora);
  assert.equal(urgencia, 'urgente');
  assert.ok(horasRestantes < 0);
});

test('calcularPrazoLimiteContingencia: venda de sexta à tarde — sábado/domingo não contam, prazo vira segunda', () => {
  // Constrói a próxima sexta-feira a partir de agora (não depende da data em que o teste roda).
  const hoje = new Date();
  const diasAteSexta = (5 - hoje.getDay() + 7) % 7;
  const sexta = new Date(hoje);
  sexta.setDate(hoje.getDate() + diasAteSexta);
  sexta.setHours(15, 0, 0, 0); // sexta à tarde

  const prazoLimite = filaService.calcularPrazoLimiteContingencia(sexta);

  assert.equal(prazoLimite.getDay(), 1, 'prazo deve cair numa segunda-feira (sábado/domingo pulados)');
  const diffDias = Math.round((prazoLimite.getTime() - sexta.getTime()) / (24 * 60 * 60 * 1000));
  assert.equal(diffDias, 3, 'de sexta até o fim de segunda são 3 dias corridos (sábado e domingo pulados)');
  assert.equal(prazoLimite.getHours(), 23);
  assert.equal(prazoLimite.getMinutes(), 59);
});

test('statusFila: contagem correta, urgência de cada pendência, e contador de "urgente" no topo', async () => {
  const tenant = await criarTenantCompleto('07');
  const produtoTranquilo = await criarProduto(tenant.id, '07a');
  const produtoUrgente = await criarProduto(tenant.id, '07b');

  const vendaTranquila = await criarVendaPendenteDireto(tenant.id, produtoTranquilo.id, { criadoEm: new Date() });
  const vendaUrgente = await criarVendaPendenteDireto(tenant.id, produtoUrgente.id, { criadoEm: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) });
  await prisma.venda.update({ where: { id: vendaUrgente.id }, data: { statusEmissaoFiscal: 'falha_temporaria', proximaTentativaEm: new Date(Date.now() - 1000) } });

  try {
    const status = await filaService.statusFila();
    const itemTranquilo = status.itens.find((i) => i.id === vendaTranquila.id);
    const itemUrgente = status.itens.find((i) => i.id === vendaUrgente.id);

    assert.ok(itemTranquilo, 'venda pendente recente deve aparecer no status');
    assert.equal(itemTranquilo.urgencia, 'tranquilo');
    assert.ok(itemUrgente, 'venda antiga em falha temporária deve aparecer no status');
    assert.equal(itemUrgente.urgencia, 'urgente');
    assert.ok(status.totalUrgente >= 1, 'contador de urgente no topo deve refletir pelo menos a venda urgente criada');
    assert.ok(status.totalPendente >= 1);
    assert.ok(status.totalFalhaTemporaria >= 1);
  } finally {
    await limpar(tenant.id, [vendaTranquila.id, vendaUrgente.id], [produtoTranquilo.id, produtoUrgente.id]);
  }
});

test('statusFila: urgência usa dataVenda (momento real), não criadoEm (momento do INSERT) — venda sincronizada tarde', async () => {
  const tenant = await criarTenantCompleto('08');
  const produto = await criarProduto(tenant.id, '08a');

  // Simula uma venda offline sincronizada bem depois: criadoEm é agora
  // (acabou de ser inserida no banco), mas dataVenda é de 2 dias atrás
  // (quando o operador realmente vendeu, sem conexão). Se o cálculo ainda
  // lesse criadoEm, isso apareceria como "tranquilo" — o bug original.
  const vendaSincronizadaTarde = await criarVendaPendenteDireto(tenant.id, produto.id, {
    criadoEm: new Date(),
    dataVenda: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  });

  try {
    const status = await filaService.statusFila();
    const item = status.itens.find((i) => i.id === vendaSincronizadaTarde.id);
    assert.ok(item, 'venda sincronizada tarde deve aparecer no status');
    assert.notEqual(item.urgencia, 'tranquilo', 'com 2 dias reais decorridos desde a venda, não pode ser "tranquilo" mesmo com criadoEm=agora');
    assert.equal(item.urgencia, 'urgente', 'prazo de contingência (1 dia útil) já vencido há muito — deve ser urgente');
  } finally {
    await limpar(tenant.id, [vendaSincronizadaTarde.id], [produto.id]);
  }
});

after(async () => {
  await prisma.$disconnect();
});
