/**
 * Arquivo: filaTransmissaoContingencia.test.js
 * Responsabilidade: Regressão de nfceContingenciaTransmissao.service
 * (transmitirContingencia) e filaTransmissaoContingencia.service
 * (processarFilaTransmissaoContingencia) — tudo com SEFAZ_MOCK=true, sem
 * rede real. Cobre: transmissão bem-sucedida (cStat=100 → 'emitido' +
 * emitidoViaContingencia=true), guarda contra transmitir venda sem
 * xmlNfce/chaveNfce, rejeição de conteúdo (não agenda retry), falha de
 * conexão (agenda retry com o MESMO endpoint, sem contingência SVC — mesma
 * decisão de filaEmissaoNfce.service.js), múltiplas vendas na mesma
 * passada, e que esta fila nunca enxerga vendas 'pendente' (do fluxo
 * normal). A direção oposta (filaEmissaoNfce nunca enxerga venda em
 * contingência) é coberta em venda-contingencia-sync.test.js, por query
 * direta escopada por tenant — de propósito, NÃO chamando
 * filaEmissaoNfce.processarFilaEmissao() de verdade aqui: essa função é
 * global (sem filtro de tenantId, por design), e chamá-la interferiria
 * nos fixtures de filaEmissaoNfce.test.js quando os dois arquivos rodam
 * em paralelo (achado real: causou falha intermitente em
 * filaEmissaoNfce.test.js:"processa múltiplas vendas..." antes desta
 * versão remover essa chamada).
 * Uso: node --test src/tests/filaTransmissaoContingencia.test.js
 * Depende de: DATABASE_URL válido em .env.
 */
process.env.SEFAZ_MOCK = 'true';
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const { transmitirContingencia } = require('../services/nfceContingenciaTransmissao.service');
const filaContingenciaService = require('../services/filaTransmissaoContingencia.service');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');
const { AppError } = require('../utils/response');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenantCompleto(sufixo) {
  return prisma.tenant.create({
    data: {
      nome: 'Teste Fila Contingencia ' + sufixo, cnpj: cnpjTeste(sufixo), email: `fila-cont-${sufixo}@teste.com`,
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

async function criarProduto(tenantId, sufixo) {
  return prisma.produto.create({
    data: { tenantId, ean: '99' + Date.now().toString().slice(-11) + sufixo, nome: 'Produto Fila Cont ' + sufixo, preco: 20, ncm: '10063011', cfop: '5102' },
  });
}

/** Venda já com XML de contingência "assinado" (fake), pronta pra transmitir — status inicial = contingencia_pendente_transmissao. */
async function criarVendaContingenciaPendente(tenantId, produtoId, { criadoEm, dataVenda, chaveNfce, xmlNfce } = {}) {
  return prisma.venda.create({
    data: {
      tenantId, subtotal: 20, total: 20,
      chaveNfce: chaveNfce || ('41260711222333000181650010000' + Date.now().toString().slice(-9) + '00'),
      xmlNfce: xmlNfce || '<?xml version="1.0" encoding="UTF-8"?>\n<NFe><infNFe><Signature>fake</Signature></infNFe></NFe>',
      statusEmissaoFiscal: 'contingencia_pendente_transmissao',
      criadoEm, dataVenda: dataVenda ?? criadoEm,
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
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('transmitirContingencia: sem xmlNfce/chaveNfce, recusa ANTES de chamar qualquer webservice', async () => {
  const tenant = await criarTenantCompleto('01');
  const produto = await criarProduto(tenant.id, '01');
  const venda = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 20, total: 20, statusEmissaoFiscal: 'contingencia_pendente_transmissao',
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 20, custoUnitario: 10, subtotal: 20, total: 20 }] },
      pagamentos: { create: [{ forma: 'pix', valor: 20 }] },
    },
  });
  try {
    await assert.rejects(
      () => transmitirContingencia(tenant.id, venda.id),
      (err) => err.status === 422 && /não tem XML de contingência assinado/.test(err.message)
    );
  } finally {
    await limpar(tenant.id, [venda.id], [produto.id]);
  }
});

test('transmitirContingencia: sucesso (mock) marca emitido + emitidoViaContingencia=true, chaveNfce preservada (não regerada)', async () => {
  const tenant = await criarTenantCompleto('02');
  const produto = await criarProduto(tenant.id, '02');
  const venda = await criarVendaContingenciaPendente(tenant.id, produto.id, { criadoEm: new Date() });
  try {
    const atualizada = await transmitirContingencia(tenant.id, venda.id);
    assert.equal(atualizada.statusEmissaoFiscal, 'emitido');
    assert.equal(atualizada.emitidoViaContingencia, true);
    assert.equal(atualizada.chaveNfce, venda.chaveNfce, 'chaveNfce deve ser exatamente a que já veio assinada — transmissão não gera uma nova');
    assert.equal(atualizada.xmlNfce, venda.xmlNfce, 'xmlNfce transmitido deve ser o mesmo já assinado, sem alteração');
    assert.ok(atualizada.protocoloAutorizacao);
    assert.ok(atualizada.emitidoEm);
  } finally {
    await limpar(tenant.id, [venda.id], [produto.id]);
  }
});

test('transmitirContingencia: rejeição de conteúdo lança AppError 422 com cStat/xMotivo', async () => {
  const tenant = await criarTenantCompleto('03');
  const produto = await criarProduto(tenant.id, '03');
  const venda = await criarVendaContingenciaPendente(tenant.id, produto.id, { criadoEm: new Date() });
  try {
    const chamarRejeitando = async () => ({ cStat: '539', xMotivo: 'Rejeição: Duplicidade de NF-e, com diferença na Chave de Acesso' });
    await assert.rejects(
      () => transmitirContingencia(tenant.id, venda.id, { chamarWebservice: chamarRejeitando }),
      (err) => err instanceof AppError && err.status === 422 && /539/.test(err.message)
    );
    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.statusEmissaoFiscal, 'contingencia_pendente_transmissao', 'transmitirContingencia sozinha não muda o status em caso de rejeição — quem faz isso é o worker (processarFilaTransmissaoContingencia)');
  } finally {
    await limpar(tenant.id, [venda.id], [produto.id]);
  }
});

test('processarFilaTransmissaoContingencia: sucesso (mock) marca emitido', async () => {
  const tenant = await criarTenantCompleto('04');
  const produto = await criarProduto(tenant.id, '04');
  const venda = await criarVendaContingenciaPendente(tenant.id, produto.id, { criadoEm: new Date() });
  try {
    const resumo = await filaContingenciaService.processarFilaTransmissaoContingencia();
    assert.ok(resumo.transmitidas >= 1);
    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.statusEmissaoFiscal, 'emitido');
    assert.equal(depois.emitidoViaContingencia, true);
  } finally {
    await limpar(tenant.id, [venda.id], [produto.id]);
  }
});

test('processarFilaTransmissaoContingencia: rejeição de conteúdo marca statusEmissaoFiscal=rejeitado, sem agendar nova tentativa', async () => {
  const tenant = await criarTenantCompleto('05');
  const produto = await criarProduto(tenant.id, '05');
  const venda = await criarVendaContingenciaPendente(tenant.id, produto.id, { criadoEm: new Date() });
  try {
    const chamarRejeitando = async () => ({ cStat: '539', xMotivo: 'Rejeição: Duplicidade de NF-e' });
    const resumo = await filaContingenciaService.processarFilaTransmissaoContingencia({ chamarWebservice: chamarRejeitando });
    assert.equal(resumo.rejeitadas, 1);
    assert.equal(resumo.transmitidas, 0);
    assert.equal(resumo.falhaTemporaria, 0);

    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.statusEmissaoFiscal, 'rejeitado');
    assert.equal(depois.tentativasEmissao, 1);
    assert.equal(depois.proximaTentativaEm, null, 'rejeição de conteúdo não agenda retry automático');
  } finally {
    await limpar(tenant.id, [venda.id], [produto.id]);
  }
});

test('processarFilaTransmissaoContingencia: falha de conexão marca falha_temporaria (permanece contingencia_pendente_transmissao) com proximaTentativaEm correto', async () => {
  const tenant = await criarTenantCompleto('06');
  const produto = await criarProduto(tenant.id, '06');
  const venda = await criarVendaContingenciaPendente(tenant.id, produto.id, { criadoEm: new Date() });
  try {
    let chamadas = 0;
    const chamarSempreFalha = async () => { chamadas += 1; throw new Error('ECONNREFUSED (simulado)'); };
    const antes = Date.now();
    const resumo = await filaContingenciaService.processarFilaTransmissaoContingencia({ chamarWebservice: chamarSempreFalha });
    assert.equal(resumo.falhaTemporaria, 1);
    assert.equal(resumo.transmitidas, 0);
    assert.equal(chamadas, 1, 'sem contingência SVC — a fila tenta de novo só na próxima passada, não um segundo endpoint agora');

    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.statusEmissaoFiscal, 'contingencia_pendente_transmissao', 'continua no mesmo status — o XML já assinado não muda, só reagenda');
    assert.equal(depois.tentativasEmissao, 1);
    assert.ok(depois.proximaTentativaEm);
    const minutosAgendados = (new Date(depois.proximaTentativaEm).getTime() - antes) / 60000;
    assert.ok(Math.abs(minutosAgendados - filaContingenciaService.INTERVALO_RETRY_MINUTOS) < 0.5, `proximaTentativaEm deve ser ~${filaContingenciaService.INTERVALO_RETRY_MINUTOS} minutos à frente, foi ${minutosAgendados}`);
  } finally {
    await limpar(tenant.id, [venda.id], [produto.id]);
  }
});

test('processarFilaTransmissaoContingencia: processa múltiplas vendas na mesma chamada — uma falhar não impede as outras', async () => {
  const tenant = await criarTenantCompleto('07');
  const produtoA = await criarProduto(tenant.id, '07a');
  const produtoB = await criarProduto(tenant.id, '07b');
  const produtoC = await criarProduto(tenant.id, '07c');
  const base = Date.now() - 10000;
  const vendaA = await criarVendaContingenciaPendente(tenant.id, produtoA.id, { criadoEm: new Date(base) });
  const vendaB = await criarVendaContingenciaPendente(tenant.id, produtoB.id, { criadoEm: new Date(base + 1000) });
  const vendaC = await criarVendaContingenciaPendente(tenant.id, produtoC.id, { criadoEm: new Date(base + 2000) });
  try {
    let chamada = 0;
    const chamarComFalhaNaSegunda = async () => {
      chamada += 1;
      if (chamada === 2) throw new Error('ECONNREFUSED (simulado) — falha proposital na segunda venda');
      return { cStat: '100', xMotivo: 'Autorizado o uso da NF-e (MOCK)', protocolo: 'MOCK' + chamada };
    };

    const resumo = await filaContingenciaService.processarFilaTransmissaoContingencia({ chamarWebservice: chamarComFalhaNaSegunda });
    assert.equal(resumo.total, 3);
    assert.equal(resumo.transmitidas, 2);
    assert.equal(resumo.falhaTemporaria, 1);

    const [depoisA, depoisB, depoisC] = await Promise.all([
      prisma.venda.findUnique({ where: { id: vendaA.id } }),
      prisma.venda.findUnique({ where: { id: vendaB.id } }),
      prisma.venda.findUnique({ where: { id: vendaC.id } }),
    ]);
    assert.equal(depoisA.statusEmissaoFiscal, 'emitido');
    assert.equal(depoisB.statusEmissaoFiscal, 'contingencia_pendente_transmissao');
    assert.equal(depoisC.statusEmissaoFiscal, 'emitido');
  } finally {
    await limpar(tenant.id, [vendaA.id, vendaB.id, vendaC.id], [produtoA.id, produtoB.id, produtoC.id]);
  }
});

test('buscarPendentes: pega venda contingencia_pendente_transmissao (a query filtra especificamente por esse status)', async () => {
  // Prova só o caso positivo, com fixture tenant-scoped (sem inserir uma
  // venda 'pendente' real na tabela global — ver nota no topo do arquivo:
  // fazer isso causou flakiness cruzada em filaEmissaoNfce.test.js quando
  // os dois arquivos rodam em paralelo contra o mesmo Postgres. A exclusão
  // de 'pendente' já é garantida estruturalmente pelo WHERE de
  // buscarPendentes, que filtra só por STATUS_PENDENTE
  // ('contingencia_pendente_transmissao') — ver filaTransmissaoContingencia.
  // service.js — e a direção "contingência nunca vira 'pendente'" é
  // coberta em venda-contingencia-sync.test.js.
  const tenant = await criarTenantCompleto('08');
  const produtoContingencia = await criarProduto(tenant.id, '08a');
  const vendaContingencia = await criarVendaContingenciaPendente(tenant.id, produtoContingencia.id, { criadoEm: new Date() });
  try {
    const pendentesContingencia = await filaContingenciaService.buscarPendentes();
    assert.ok(pendentesContingencia.some((v) => v.id === vendaContingencia.id), 'venda em contingência deve aparecer nos pendentes desta fila');
  } finally {
    await limpar(tenant.id, [vendaContingencia.id], [produtoContingencia.id]);
  }
});

after(async () => {
  await prisma.$disconnect();
});
