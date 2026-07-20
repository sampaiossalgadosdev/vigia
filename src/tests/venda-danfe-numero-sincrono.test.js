/**
 * Arquivo: venda-danfe-numero-sincrono.test.js
 * Responsabilidade: Regressão da reserva SÍNCRONA de número+chave de
 * acesso em venda.service.registrar() (fatia DANFE) —
 * reservarNumeroEChaveNfceNaTransacao roda DENTRO da mesma transação que
 * cria a Venda, pra número/chave existirem já no momento da venda (DANFE
 * impresso na hora, sem esperar o worker assíncrono).
 * A prova mais importante aqui: a chave reservada na hora precisa ser
 * EXATAMENTE a mesma que emitirNfce/gerarXmlNfce usa depois, quando o
 * worker assíncrono (filaEmissaoNfce) processa de verdade — se cNF fosse
 * recalculado nesse momento (bug real que eu quase introduzi), a chave
 * transmitida à SEFAZ divergiria da chave já impressa e entregue ao
 * cliente no cupom.
 * Uso: node --test src/tests/venda-danfe-numero-sincrono.test.js
 * Depende de: DATABASE_URL válido em .env. SEFAZ_MOCK=true.
 */
process.env.SEFAZ_MOCK = 'true';
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const vendaService = require('../services/venda.service');
const { emitirNfce } = require('../services/nfceEmissao.service');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenantCompleto(sufixo) {
  return prisma.tenant.create({
    data: {
      nome: 'Teste DANFE Sincrono ' + sufixo, cnpj: cnpjTeste(sufixo), email: `danfe-sync-${sufixo}@teste.com`,
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
    data: { nome: 'Teste DANFE Incompleto ' + sufixo, cnpj: cnpjTeste(sufixo), email: `danfe-incompleto-${sufixo}@teste.com` },
  });
}

async function criarProduto(tenantId, sufixo) {
  // cstIbsCbs '000'/cClassTrib '000001': códigos REAIS (RT 2025.002) —
  // necessários pra emitirNfce chegar até o fim (ver tributoFiscal.service.js).
  return prisma.produto.create({
    data: { tenantId, ean: '99' + Date.now().toString().slice(-11) + sufixo, nome: 'Produto DANFE ' + sufixo, preco: 20, ncm: '10063011', cfop: '5102', cstIbsCbs: '000', cClassTrib: '000001' },
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

test('registrar(): duas vendas sucessivas do mesmo tenant recebem numeroNfce/chaveNfce sequenciais e distintos, já na criação', async () => {
  const tenant = await criarTenantCompleto('01');
  const produto = await criarProduto(tenant.id, '01');
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  let vendaA, vendaB;
  try {
    vendaA = await vendaService.registrar(tenant.id, { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 20 }] }, { id: 'op' }, '127.0.0.1');
    vendaB = await vendaService.registrar(tenant.id, { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 20 }] }, { id: 'op' }, '127.0.0.1');

    assert.equal(vendaA.numeroNfce, 1);
    assert.equal(vendaB.numeroNfce, 2);
    assert.match(vendaA.chaveNfce, /^\d{44}$/);
    assert.match(vendaB.chaveNfce, /^\d{44}$/);
    assert.notEqual(vendaA.chaveNfce, vendaB.chaveNfce);
  } finally {
    await limpar(tenant.id, [vendaA?.id, vendaB?.id].filter(Boolean), [produto.id]);
  }
});

test('registrar(): tenant SEM configuração fiscal completa NÃO reserva número/chave (fica tudo null, sem tocar Tenant.ultimoNumeroNfce)', async () => {
  const tenant = await criarTenantIncompleto('02');
  const produto = await criarProduto(tenant.id, '02');
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  let venda;
  try {
    venda = await vendaService.registrar(tenant.id, { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 20 }] }, { id: 'op' }, '127.0.0.1');

    assert.equal(venda.statusEmissaoFiscal, 'nao_aplicavel');
    assert.equal(venda.numeroNfce, null);
    assert.equal(venda.chaveNfce, null);
    const tenantDepois = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    assert.equal(tenantDepois.ultimoNumeroNfce, 0, 'contador não pode ter sido incrementado pra um tenant que nem entra na fila');
  } finally {
    await limpar(tenant.id, venda ? [venda.id] : [], [produto.id]);
  }
});

test('PROVA CRÍTICA: chave reservada na hora (registrar) é EXATAMENTE a mesma usada depois na emissão real (emitirNfce/gerarXmlNfce) — cNF nunca é recalculado', async () => {
  const tenant = await criarTenantCompleto('03');
  const produto = await criarProduto(tenant.id, '03');
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  let venda;
  try {
    venda = await vendaService.registrar(tenant.id, { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 20 }] }, { id: 'op' }, '127.0.0.1');
    const chaveNoMomentoDaVenda = venda.chaveNfce;
    assert.match(chaveNoMomentoDaVenda, /^\d{44}$/, 'DANFE precisaria dessa chave pra imprimir na hora');

    // Simula o worker assíncrono rodando minutos depois (mesmo caminho de
    // filaEmissaoNfce.processarFilaEmissao).
    const atualizada = await emitirNfce(tenant.id, venda.id);

    assert.equal(atualizada.chaveNfce, chaveNoMomentoDaVenda, 'a chave TRANSMITIDA à SEFAZ tem que ser a MESMA que já foi impressa e entregue ao cliente no DANFE — nunca pode divergir');
    assert.equal(atualizada.numeroNfce, venda.numeroNfce);
    // O XML não guarda a chave inteira como uma string só — ela é
    // reconstruída a partir de campos separados em <ide> (cNF, nNF, etc).
    // Confirma que CADA componente embutido no XML de fato transmitido
    // bate com o que está codificado posicionalmente na chave já impressa.
    const cNFDaChave = chaveNoMomentoDaVenda.slice(35, 43);
    const numeroDaChave = String(Number(chaveNoMomentoDaVenda.slice(25, 34)));
    assert.match(atualizada.xmlNfce, new RegExp(`<cNF>${cNFDaChave}</cNF>`), 'cNF do XML transmitido deve bater com o cNF já embutido na chave impressa');
    assert.match(atualizada.xmlNfce, new RegExp(`<nNF>${numeroDaChave}</nNF>`), 'nNF do XML transmitido deve bater com o número já embutido na chave impressa');
  } finally {
    await limpar(tenant.id, venda ? [venda.id] : [], [produto.id]);
  }
});

test('sync() com contingência já assinada NÃO reserva número/chave síncrona de novo (usa a que já veio do ASSINATURA, não sobrescreve)', async () => {
  const tenant = await criarTenantCompleto('04');
  const produto = await criarProduto(tenant.id, '04');
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const chaveContingencia = '41260711222333000181650020000000012345678901';
  const localId = 'local-danfe-04';
  let venda;
  try {
    await vendaService.sync(tenant.id, [{
      localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 20 }],
      contingencia: { assinado: true, chaveAcesso: chaveContingencia, xmlAssinado: '<NFe><infNFe><Signature>fake</Signature></infNFe></NFe>' },
    }]);
    venda = await prisma.venda.findFirst({ where: { tenantId: tenant.id, localId } });

    assert.equal(venda.chaveNfce, chaveContingencia, 'chave deve ser exatamente a de contingência, não uma nova reservada por engano');
    assert.equal(venda.numeroNfce, null, 'numeroNfce (contador da série online) não deve ser tocado — contingência usa série própria, controlada no app ASSINATURA');
    const tenantDepois = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    assert.equal(tenantDepois.ultimoNumeroNfce, 0, 'Tenant.ultimoNumeroNfce (série online) não pode ter incrementado numa venda de contingência');
  } finally {
    await limpar(tenant.id, venda ? [venda.id] : [], [produto.id]);
  }
});

after(async () => {
  await prisma.$disconnect();
});
