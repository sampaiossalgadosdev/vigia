/**
 * Arquivo: nfceEmissao.test.js
 * Responsabilidade: Confirma emitirNfce/cancelarNfce (Fase 1c) — tudo
 * com SEFAZ_MOCK=true, sem rede real. Cobre: configuração fiscal
 * incompleta bloqueando ANTES de qualquer coisa, emissão com sucesso
 * (chave real de 44 dígitos substitui o localId), rejeição da SEFAZ,
 * cancelamento dentro/fora da janela, e contingência SVC (sucesso e
 * indisponibilidade total).
 * Uso: node --test src/tests/nfceEmissao.test.js
 * Depende de: DATABASE_URL válido em .env.
 */
process.env.SEFAZ_MOCK = 'true';
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const { emitirNfce, cancelarNfce } = require('../services/nfceEmissao.service');
const { resolverUrlsFiscais } = require('../config/webservicesSefaz');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenantCompleto(sufixo) {
  return prisma.tenant.create({
    data: {
      nome: 'Teste Emissao NFCe ' + sufixo, cnpj: cnpjTeste(sufixo), email: `emissao-${sufixo}@teste.com`,
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

async function criarVendaDeTeste(tenantId, { chaveNfce = 'localid-abc123', emitidoEm } = {}) {
  const produto = await prisma.produto.create({
    data: { tenantId, ean: '97' + Date.now().toString().slice(-11), nome: 'Produto Emissao Teste', preco: 20, ncm: '10063011', cfop: '5102' },
  });
  const venda = await prisma.venda.create({
    data: {
      tenantId, subtotal: 20, total: 20, chaveNfce, emitidoEm,
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 20, custoUnitario: 10, subtotal: 20, total: 20 }] },
      pagamentos: { create: [{ forma: 'pix', valor: 20 }] },
    },
  });
  return { produto, venda };
}

async function limpar(tenantId, vendaId, produtoId) {
  if (vendaId) {
    await prisma.vendaPagamento.deleteMany({ where: { vendaId } });
    await prisma.vendaItem.deleteMany({ where: { vendaId } });
    await prisma.venda.delete({ where: { id: vendaId } }).catch(() => {});
  }
  if (produtoId) await prisma.produto.delete({ where: { id: produtoId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('emitirNfce: configuração fiscal incompleta bloqueia ANTES de gerar XML ou chamar qualquer coisa', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Emissao Incompleto', cnpj: cnpjTeste('01'), email: 'emissao-incompleto@teste.com' },
  });
  try {
    await assert.rejects(
      () => emitirNfce(tenant.id, 'venda-que-nem-existe'),
      (err) => err.status === 422 && /Configuração fiscal incompleta/.test(err.message)
    );
  } finally {
    await limpar(tenant.id);
  }
});

test('emitirNfce: tenant completo, mock retorna sucesso — chaveNfce vira a chave real de 44 dígitos', async () => {
  const tenant = await criarTenantCompleto('02');
  const { produto, venda } = await criarVendaDeTeste(tenant.id);
  try {
    const atualizada = await emitirNfce(tenant.id, venda.id);
    assert.match(atualizada.chaveNfce, /^\d{44}$/, 'chaveNfce deve virar a chave real de 44 dígitos');
    assert.notEqual(atualizada.chaveNfce, 'localid-abc123');
    assert.ok(atualizada.protocoloAutorizacao);
    assert.equal(atualizada.emitidoViaContingencia, false);
    assert.ok(atualizada.emitidoEm);
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('emitirNfce: mock simula rejeição (cStat != 100) — erro com motivo, Venda não fica com chave inválida', async () => {
  const tenant = await criarTenantCompleto('03');
  const { produto, venda } = await criarVendaDeTeste(tenant.id);
  try {
    const chamarRejeitando = async () => ({ cStat: '204', xMotivo: 'Rejeição: duplicidade de NF-e' });
    await assert.rejects(
      () => emitirNfce(tenant.id, venda.id, { chamarWebservice: chamarRejeitando }),
      (err) => err.status === 422 && /204/.test(err.message) && /duplicidade/.test(err.message)
    );

    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.chaveNfce, 'localid-abc123', 'venda não pode ficar com chave inválida após rejeição');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('cancelarNfce: dentro da janela — sucesso simulado, status da Venda atualizado', async () => {
  const tenant = await criarTenantCompleto('04');
  const { produto, venda } = await criarVendaDeTeste(tenant.id, { chaveNfce: '3'.repeat(44), emitidoEm: new Date() });
  try {
    const atualizada = await cancelarNfce(tenant.id, venda.id, 'Cliente desistiu da compra no caixa');
    assert.equal(atualizada.status, 'cancelada');
    assert.ok(atualizada.protocoloCancelamento);
    assert.ok(atualizada.canceladoEm);
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('cancelarNfce: fora da janela (emitido há 40 minutos) — erro claro, sem tentar enviar o evento', async () => {
  const tenant = await criarTenantCompleto('05');
  const emitidoEm40minAtras = new Date(Date.now() - 40 * 60 * 1000);
  const { produto, venda } = await criarVendaDeTeste(tenant.id, { chaveNfce: '4'.repeat(44), emitidoEm: emitidoEm40minAtras });
  try {
    let tentouEnviar = false;
    const enviarFake = async () => { tentouEnviar = true; return { ok: true, protocolo: 'X' }; };

    await assert.rejects(
      () => cancelarNfce(tenant.id, venda.id, 'Justificativa de teste com mais de 15 caracteres', { enviarEventoCancelamento: enviarFake }),
      (err) => err.status === 422 && /Prazo de cancelamento expirado/.test(err.message)
    );
    assert.equal(tentouEnviar, false, 'não deveria ter tentado enviar o evento — prazo já tinha expirado');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('contingência: falha de conexão no principal — sistema tenta o SVC, autoriza, marca emitidoViaContingencia', async () => {
  const tenant = await criarTenantCompleto('06');
  const { produto, venda } = await criarVendaDeTeste(tenant.id);
  try {
    const urls = resolverUrlsFiscais(tenant.uf, tenant.ambienteFiscal);
    const chamarComFalhaNoPrincipal = async (url) => {
      if (url === urls.autorizacao) throw new Error('ECONNREFUSED (simulado) — SEFAZ do estado fora do ar');
      if (url === urls.contingenciaSvc.autorizacao) return { cStat: '100', xMotivo: 'Autorizado o uso da NF-e (SVC)', protocolo: 'SVC999' };
      throw new Error('URL inesperada no teste: ' + url);
    };

    const atualizada = await emitirNfce(tenant.id, venda.id, { chamarWebservice: chamarComFalhaNoPrincipal });
    assert.match(atualizada.chaveNfce, /^\d{44}$/);
    assert.equal(atualizada.emitidoViaContingencia, true);
    assert.equal(atualizada.protocoloAutorizacao, 'SVC999');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('contingência: falha em AMBOS (principal e SVC) — erro claro de indisponibilidade total, sem chave gravada', async () => {
  const tenant = await criarTenantCompleto('07');
  const { produto, venda } = await criarVendaDeTeste(tenant.id);
  try {
    const chamarSempreFalha = async () => { throw new Error('ECONNREFUSED (simulado)'); };

    await assert.rejects(
      () => emitirNfce(tenant.id, venda.id, { chamarWebservice: chamarSempreFalha }),
      (err) => err.status === 503 && /indisponíveis/.test(err.message)
    );

    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.chaveNfce, 'localid-abc123', 'nenhuma chave deve ser gravada quando principal e SVC falham');
    assert.equal(depois.emitidoViaContingencia, false);
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('modo real (SEFAZ_MOCK=false): emissão real ainda não implementada — erro claro, sem tentativa de rede', async () => {
  const tenant = await criarTenantCompleto('08');
  const { produto, venda } = await criarVendaDeTeste(tenant.id);
  const mockAnterior = process.env.SEFAZ_MOCK;
  const nodeEnvAnterior = process.env.NODE_ENV;
  try {
    process.env.SEFAZ_MOCK = 'false';
    process.env.NODE_ENV = 'production'; // garante que mockAtivo() não caia no atalho de teste
    await assert.rejects(
      () => emitirNfce(tenant.id, venda.id),
      (err) => err.status === 501 && /não implementada/.test(err.message)
    );
  } finally {
    process.env.SEFAZ_MOCK = mockAnterior;
    process.env.NODE_ENV = nodeEnvAnterior;
    await limpar(tenant.id, venda.id, produto.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
