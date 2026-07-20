/**
 * Arquivo: venda-cancelamento-fiscal.test.js
 * Responsabilidade: Regressão de venda.service.cancelar quando integrado
 * com nfceEmissao.service.cancelarNfce (achado de revisão 2026-07-19:
 * cancelarNfce existia e era testado, mas não estava pendurado em nenhuma
 * rota — cancelar uma venda revertia estoque/caixa mas nunca avisava a
 * SEFAZ, deixando a NFC-e "autorizada" pro fisco). Pesquisa (ver relatório
 * da tarefa) confirmou: só é possível cancelar na SEFAZ um documento JÁ
 * AUTORIZADO (evento 110111 exige nProtEvento) — por isso a integração é
 * condicionada a statusEmissaoFiscal==='emitido', não a chaveNfce (que
 * pode estar preenchida por reserva síncrona sem a venda ter sido
 * autorizada ainda).
 * Decisão confirmada com o usuário 2026-07-19: se o cancelamento fiscal
 * falhar (janela de 30min expirada, SEFAZ recusa, rede fora), a venda
 * INTEIRA não é cancelada — nem estoque nem caixa mudam.
 * Cobre também a blindagem correspondente nos workers assíncronos
 * (filaEmissaoNfce/filaTransmissaoContingencia) contra processar uma venda
 * já cancelada.
 * Uso: node --test --test-concurrency=1 src/tests/venda-cancelamento-fiscal.test.js
 * (concurrency=1: este arquivo cria vários tenants fiscais completos com
 * certificado mock — mais pesado que a média; sob concorrência padrão do
 * runner, observamos com alguma frequência instabilidade de conexão com o
 * Postgres do Railway, mesmo problema de proxy já documentado em outros
 * arquivos desta suíte — não uma falha de lógica.)
 * Depende de: DATABASE_URL válido em .env. SEFAZ_MOCK=true.
 */
process.env.SEFAZ_MOCK = 'true';
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const vendaService = require('../services/venda.service');
const filaEmissaoService = require('../services/filaEmissaoNfce.service');
const filaContingenciaService = require('../services/filaTransmissaoContingencia.service');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

/** Tenant mínimo — suficiente pra vendas cujo cancelamento NUNCA chega a chamar a SEFAZ (statusEmissaoFiscal != 'emitido'). */
async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Cancelamento Fiscal ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `cancel-fiscal-${sufixo}-${Date.now()}@teste.com` },
  });
}

/** Tenant fiscal completo — necessário só pros casos 'emitido', onde cancelarNfce de fato resolve UF/certificado (mock). */
async function criarTenantCompleto(sufixo) {
  return prisma.tenant.create({
    data: {
      nome: `Teste Cancelamento Fiscal Completo ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `cancel-fiscal-completo-${sufixo}-${Date.now()}@teste.com`,
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
    data: { tenantId, ean: '96' + Date.now().toString().slice(-11) + sufixo, nome: 'Produto Cancelamento ' + sufixo, preco: 20, custoMedio: 10 },
  });
}

/** Venda pronta (sem passar por registrar()) com o statusEmissaoFiscal desejado — mesmo padrão de venda-qrcode.test.js/filaTransmissaoContingencia.test.js. */
async function criarVenda(tenantId, produtoId, overrides = {}) {
  return prisma.venda.create({
    data: {
      tenantId, subtotal: 20, total: 20,
      itens: { create: [{ produtoId, quantidade: 1, precoUnitario: 20, custoUnitario: 10, subtotal: 20, total: 20 }] },
      pagamentos: { create: [{ forma: 'pix', valor: 20 }] },
      ...overrides,
    },
  });
}

async function limpar(tenantId, vendaId, produtoId) {
  await prisma.vendaPagamento.deleteMany({ where: { vendaId } }).catch(() => {});
  await prisma.vendaItem.deleteMany({ where: { vendaId } }).catch(() => {});
  await prisma.venda.delete({ where: { id: vendaId } }).catch(() => {});
  await prisma.movimentacaoEstoque.deleteMany({ where: { produtoId } }).catch(() => {});
  await prisma.produto.delete({ where: { id: produtoId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('cancelar(): venda emitida (autorizada pela SEFAZ, dentro da janela) — cancela na SEFAZ E reverte estoque/caixa', async () => {
  const tenant = await criarTenantCompleto('01');
  const produto = await criarProduto(tenant.id, '01');
  const caixa = await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  const venda = await criarVenda(tenant.id, produto.id, {
    chaveNfce: '1'.repeat(44), statusEmissaoFiscal: 'emitido', emitidoEm: new Date(),
  });
  try {
    const resultado = await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Cliente desistiu da compra no caixa', '127.0.0.1');
    assert.deepEqual(resultado, { cancelada: true });

    const vendaDepois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaDepois.status, 'cancelada');
    assert.ok(vendaDepois.protocoloCancelamento, 'evento de cancelamento fiscal deve ter rodado (mock) e gravado o protocolo');
    assert.equal(vendaDepois.canceladoPor, 'usuario-teste');

    const caixaDepois = await prisma.caixa.findUnique({ where: { id: caixa.id } });
    assert.equal(Number(caixaDepois.totalVendas), 0, 'caixa deve ter revertido o valor da venda');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('cancelar(): venda emitida FORA da janela de cancelamento — operação inteira falha, estoque/caixa NÃO mudam', async () => {
  const tenant = await criarTenantCompleto('02');
  const produto = await criarProduto(tenant.id, '02');
  const caixa = await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  const emitidoEm40minAtras = new Date(Date.now() - 40 * 60 * 1000);
  const venda = await criarVenda(tenant.id, produto.id, {
    chaveNfce: '2'.repeat(44), statusEmissaoFiscal: 'emitido', emitidoEm: emitidoEm40minAtras,
  });
  try {
    await assert.rejects(
      () => vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Justificativa de teste com mais de 15 caracteres', '127.0.0.1'),
      (err) => err.status === 422 && /Prazo de cancelamento expirado/.test(err.message)
    );

    const vendaDepois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaDepois.status, 'concluida', 'venda NÃO pode ficar cancelada operacionalmente se o cancelamento fiscal falhou');
    assert.equal(vendaDepois.protocoloCancelamento, null);

    const caixaDepois = await prisma.caixa.findUnique({ where: { id: caixa.id } });
    assert.equal(Number(caixaDepois.totalVendas), 20, 'caixa NÃO pode ter sido revertido — o cancelamento inteiro falhou');

    const movimentacoes = await prisma.movimentacaoEstoque.findMany({ where: { produtoId: produto.id, tipo: 'devolucao' } });
    assert.equal(movimentacoes.length, 0, 'estoque NÃO pode ter sido devolvido — o cancelamento inteiro falhou');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('cancelar(): venda "pendente" (nunca autorizada, reserva síncrona já tem chaveNfce) — sem chamada fiscal, só operacional', async () => {
  const tenant = await criarTenant('03');
  const produto = await criarProduto(tenant.id, '03');
  const caixa = await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  // chaveNfce preenchida (reserva síncrona, fatia DANFE) mas ainda não
  // autorizada — exatamente o caso que quebrava a guarda antiga de
  // cancelarNfce (baseada só em chaveNfce truthy).
  const venda = await criarVenda(tenant.id, produto.id, { chaveNfce: '3'.repeat(44), statusEmissaoFiscal: 'pendente' });
  try {
    const resultado = await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Cliente desistiu', '127.0.0.1');
    assert.deepEqual(resultado, { cancelada: true });

    const vendaDepois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaDepois.status, 'cancelada');
    assert.equal(vendaDepois.protocoloCancelamento, null, 'nenhum evento fiscal foi enviado — não havia nada autorizado pra cancelar');
    assert.equal(vendaDepois.statusEmissaoFiscal, 'pendente', 'statusEmissaoFiscal fica intacto — sinal pra uma futura rotina de inutilização de numeração');

    const caixaDepois = await prisma.caixa.findUnique({ where: { id: caixa.id } });
    assert.equal(Number(caixaDepois.totalVendas), 0, 'caixa deve ter revertido normalmente (parte operacional, sem relação com o fiscal)');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('cancelar(): venda "rejeitado" pela SEFAZ — sem chamada fiscal, só operacional', async () => {
  const tenant = await criarTenant('04');
  const produto = await criarProduto(tenant.id, '04');
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  const venda = await criarVenda(tenant.id, produto.id, { chaveNfce: '4'.repeat(44), statusEmissaoFiscal: 'rejeitado' });
  try {
    const resultado = await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Cliente desistiu', '127.0.0.1');
    assert.deepEqual(resultado, { cancelada: true });
    const vendaDepois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaDepois.status, 'cancelada');
    assert.equal(vendaDepois.protocoloCancelamento, null, 'NFC-e rejeitada nunca existiu pra SEFAZ — nada a cancelar lá');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('cancelar(): venda "contingencia_pendente_transmissao" (assinada, ainda não transmitida) — sem chamada fiscal, só operacional', async () => {
  const tenant = await criarTenant('05');
  const produto = await criarProduto(tenant.id, '05');
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  const venda = await criarVenda(tenant.id, produto.id, {
    chaveNfce: '41260711222333000181650020000000012345678901',
    xmlNfce: '<NFe><infNFe><Signature>fake</Signature></infNFe></NFe>',
    statusEmissaoFiscal: 'contingencia_pendente_transmissao',
  });
  try {
    const resultado = await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Cliente desistiu', '127.0.0.1');
    assert.deepEqual(resultado, { cancelada: true });
    const vendaDepois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaDepois.status, 'cancelada');
    assert.equal(vendaDepois.protocoloCancelamento, null, 'XML assinado mas nunca transmitido — SEFAZ não tem esse documento, nada a cancelar lá');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('filaEmissaoNfce.buscarPendentes: venda "pendente" mas CANCELADA não aparece — worker não pode emitir uma NFC-e pra venda que não existe mais', async () => {
  const tenant = await criarTenant('06');
  const produto = await criarProduto(tenant.id, '06');
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  const venda = await criarVenda(tenant.id, produto.id, { chaveNfce: '5'.repeat(44), statusEmissaoFiscal: 'pendente' });
  try {
    await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Cliente desistiu', '127.0.0.1');

    // buscarPendentes() direto (não processarFilaEmissao(), que é global e
    // sem filtro de tenant — chamar o processamento de verdade aqui
    // arriscaria interferir em fixtures de outros arquivos de teste
    // rodando em paralelo, mesmo achado já documentado em
    // filaTransmissaoContingencia.test.js).
    const pendentes = await filaEmissaoService.buscarPendentes();
    assert.ok(!pendentes.some((v) => v.id === venda.id), 'venda cancelada não deve aparecer nos pendentes de emissão, mesmo com statusEmissaoFiscal=pendente');

    const vendaDepois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaDepois.statusEmissaoFiscal, 'pendente', 'campo fica intacto — só o worker é impedido de agir, não o dado em si');
    assert.equal(vendaDepois.status, 'cancelada');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('filaTransmissaoContingencia.buscarPendentes: venda "contingencia_pendente_transmissao" mas CANCELADA não aparece', async () => {
  const tenant = await criarTenant('07');
  const produto = await criarProduto(tenant.id, '07');
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0, totalVendas: 20 } });
  const venda = await criarVenda(tenant.id, produto.id, {
    chaveNfce: '41260711222333000181650020000000019876543210',
    xmlNfce: '<NFe><infNFe><Signature>fake</Signature></infNFe></NFe>',
    statusEmissaoFiscal: 'contingencia_pendente_transmissao',
  });
  try {
    await vendaService.cancelar(tenant.id, venda.id, { id: 'usuario-teste' }, 'Cliente desistiu', '127.0.0.1');

    const pendentesContingencia = await filaContingenciaService.buscarPendentes();
    assert.ok(!pendentesContingencia.some((v) => v.id === venda.id), 'venda cancelada não deve aparecer nos pendentes de transmissão de contingência');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
