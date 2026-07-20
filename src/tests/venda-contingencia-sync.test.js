/**
 * Arquivo: venda-contingencia-sync.test.js
 * Responsabilidade: Regressão do roteamento de `body.contingencia` em
 * venda.service.sync()/registrar() — quando o PDV já sincroniza uma venda
 * com NFC-e de contingência off-line ASSINADA (pelo app ASSINATURA da
 * loja), a venda precisa ir direto para
 * statusEmissaoFiscal='contingencia_pendente_transmissao' com
 * chaveNfce/xmlNfce JÁ DEFINITIVOS — e NUNCA aparecer entre os
 * 'pendente' que filaEmissaoNfce.service (fluxo normal) processaria,
 * senão duplicaria a NFC-e (uma segunda, gerada do zero, pra mesma
 * venda). Cobre também a segurança: POST /api/vendas normal (sem
 * opcoes.contingencia) ignora qualquer `body.contingencia` malicioso,
 * mesmo padrão já usado pra body.dataVenda (ver venda-data-venda.test.js).
 * Uso: node --test src/tests/venda-contingencia-sync.test.js
 * Depende de: DATABASE_URL válido em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const vendaService = require('../services/venda.service');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Contingencia Sync ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `contsync-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.vendaPagamento.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.vendaItem.deleteMany({ where: { venda: { tenantId } } }).catch(() => {});
  await prisma.venda.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.caixa.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  // Auditoria.tenantId é ON DELETE SET NULL (confirmado na migration) — o
  // delete do tenant abaixo não falharia sem esta linha, mas deixaria pra
  // trás linhas órfãs (tenantId=null) pra sempre no banco de teste. Precisa
  // vir ANTES do tenant.delete só por organização; a ordem não afeta a FK.
  await prisma.auditoria.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

function contingenciaAssinadaExemplo(chave) {
  return {
    assinado: true,
    chaveAcesso: chave,
    xmlAssinado: '<?xml version="1.0" encoding="UTF-8"?>\n<NFe><infNFe><Signature>fake</Signature></infNFe></NFe>',
    qrCode: 'assinatura-fake',
  };
}

test('sync(): contingência assinada grava chaveNfce/xmlNfce exatamente como enviados e status=contingencia_pendente_transmissao (não "pendente")', async () => {
  const tenant = await criarTenant('01');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9801000000001', nome: 'Produto Cont 01', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const chave = '41260711222333000181650010000012345678901234'.padEnd(44, '0').slice(0, 44);
  const localId = 'local-cont-01';
  try {
    const resultados = await vendaService.sync(tenant.id, [
      {
        localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }],
        contingencia: contingenciaAssinadaExemplo(chave),
      },
    ]);
    assert.equal(resultados[0].status, 'ok');

    const venda = await prisma.venda.findFirst({ where: { tenantId: tenant.id, localId } });
    assert.ok(venda, 'venda deve ter sido persistida');
    assert.equal(venda.chaveNfce, chave, 'chaveNfce deve ser exatamente a chave já assinada em contingência, não um localId provisório');
    assert.match(venda.xmlNfce, /<Signature>fake<\/Signature>/, 'xmlNfce deve ser exatamente o XML já assinado, sem passar pelo gerador normal');
    assert.equal(venda.statusEmissaoFiscal, 'contingencia_pendente_transmissao');
    assert.equal(venda.emitidoEm, null, 'ainda não foi TRANSMITIDA à SEFAZ, só assinada — emitidoEm só é preenchido na transmissão');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('sync(): venda com contingência assinada NUNCA aparece nos pendentes da fila normal (filaEmissaoNfce) — não duplica NFC-e', async () => {
  const tenant = await criarTenant('02');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9801000000002', nome: 'Produto Cont 02', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const chave = '41260711222333000181650010000098765432109876';
  const localId = 'local-cont-02';
  try {
    await vendaService.sync(tenant.id, [
      {
        localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }],
        contingencia: contingenciaAssinadaExemplo(chave),
      },
    ]);

    // Tenant-scoped de propósito (não chama o worker global aqui: ele não
    // filtra por tenantId, ver nota em filaEmissaoNfce.service.buscarPendentes
    // — rodá-lo de verdade neste teste arriscaria interferir em fixtures de
    // OUTROS arquivos de teste rodando em paralelo contra o mesmo banco).
    const pendentesFluxoNormal = await prisma.venda.count({ where: { tenantId: tenant.id, statusEmissaoFiscal: 'pendente' } });
    assert.equal(pendentesFluxoNormal, 0, 'venda com contingência assinada não deve ter status=pendente (entraria na fila normal e duplicaria a NFC-e)');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('sync(): contingência com assinado=false (falhou no PDV) mantém comportamento de sempre — vai pra "pendente"', async () => {
  const tenant = await criarTenant('03');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9801000000003', nome: 'Produto Cont 03', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const localId = 'local-cont-03';
  try {
    const resultados = await vendaService.sync(tenant.id, [
      {
        localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }],
        contingencia: { assinado: false, motivo: 'IP do gerente não configurado nesta loja.' },
      },
    ]);
    assert.equal(resultados[0].status, 'ok');

    const venda = await prisma.venda.findFirst({ where: { tenantId: tenant.id, localId } });
    // Tenant de teste não tem configuração fiscal completa (sem CNPJ/CSC/etc
    // válidos) — o comportamento correto aqui é 'nao_aplicavel', igual a
    // qualquer venda sem contingência: a rejeição não deve criar NENHUM
    // comportamento novo/diferente do já existente.
    assert.equal(venda.statusEmissaoFiscal, 'nao_aplicavel');
    assert.equal(venda.chaveNfce, null);
    assert.equal(venda.xmlNfce, null);

    // Achado de revisão 2026-07-19/20: este motivo ("IP não configurado")
    // nunca chegou a reservar um número no ASSINATURA — sem numeroQueimado
    // no payload, não deve nascer nenhum registro de auditoria de número
    // queimado (senão toda falha de contingência, mesmo as banais, viraria
    // uma entrada de "número perdido" falsa).
    const auditoriaQueimado = await prisma.auditoria.findFirst({ where: { tenantId: tenant.id, acao: 'numero_contingencia_queimado' } });
    assert.equal(auditoriaQueimado, null, 'sem numeroQueimado no payload, não deve gravar auditoria de número queimado');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('sync(): contingência com numeroQueimado grava Auditoria consultável (número reservado no ASSINATURA e nunca usado) independente do resultado da venda', async () => {
  const tenant = await criarTenant('07');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9801000000007', nome: 'Produto Cont 07', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const localId = 'local-cont-07';
  try {
    const resultados = await vendaService.sync(tenant.id, [
      {
        localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }],
        dataVenda: '2026-07-16T14:00:00.000Z', // passado, seguro contra a checagem "não pode estar no futuro" independente da hora atual
        contingencia: {
          assinado: false,
          motivo: 'App ASSINATURA não respondeu a tempo (número 42/série 2 da contingência foi reservado e NÃO foi usado — fica pendente de inutilização formal)',
          numeroQueimado: 42,
          serieQueimada: '2',
        },
      },
    ]);
    // Tenant de teste sem config fiscal completa: registrar() segue seu
    // caminho normal ('nao_aplicavel') — o ponto deste teste é só a
    // Auditoria, não o resultado da venda em si (ver teste seguinte pro
    // caso em que registrar() falha de verdade).
    assert.equal(resultados[0].status, 'ok');

    const auditoriaQueimado = await prisma.auditoria.findFirst({ where: { tenantId: tenant.id, acao: 'numero_contingencia_queimado' } });
    assert.ok(auditoriaQueimado, 'deve existir um registro de Auditoria para o número queimado');
    assert.equal(auditoriaQueimado.entidade, 'ContingenciaNfce');
    assert.equal(auditoriaQueimado.depois.numero, 42);
    assert.equal(auditoriaQueimado.depois.serie, '2');
    assert.equal(auditoriaQueimado.depois.localId, localId);
    assert.match(auditoriaQueimado.depois.motivo, /reservado e NÃO foi usado/);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('sync(): numeroQueimado grava Auditoria mesmo quando a venda em si é rejeitada por outro motivo (produto inexistente)', async () => {
  const tenant = await criarTenant('08');
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const localId = 'local-cont-08';
  try {
    const resultados = await vendaService.sync(tenant.id, [
      {
        localId, itens: [{ produtoId: 'produto-inexistente-nesta-loja', quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }],
        contingencia: { assinado: false, motivo: 'timeout (número 9/série 2 ... pendente de inutilização formal)', numeroQueimado: 9, serieQueimada: '2' },
      },
    ]);
    // A venda em si FALHA (produto não existe) — mas o número já tinha sido
    // queimado no ASSINATURA antes disso, num momento anterior e
    // independente; o registro de auditoria precisa sobreviver mesmo assim.
    assert.equal(resultados[0].status, 'erro');

    const auditoriaQueimado = await prisma.auditoria.findFirst({ where: { tenantId: tenant.id, acao: 'numero_contingencia_queimado' } });
    assert.ok(auditoriaQueimado, 'número queimado é um fato independente do sucesso do registro da venda — precisa ser gravado mesmo com a venda rejeitada');
    assert.equal(auditoriaQueimado.depois.numero, 9);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('sync(): sem campo contingência (venda offline "antiga", sem app ASSINATURA) mantém comportamento de sempre', async () => {
  const tenant = await criarTenant('04');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9801000000004', nome: 'Produto Cont 04', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const localId = 'local-cont-04';
  try {
    const resultados = await vendaService.sync(tenant.id, [
      { localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }] },
    ]);
    assert.equal(resultados[0].status, 'ok');
    const venda = await prisma.venda.findFirst({ where: { tenantId: tenant.id, localId } });
    assert.equal(venda.statusEmissaoFiscal, 'nao_aplicavel');
    assert.equal(venda.xmlNfce, null);
  } finally {
    await limparTenant(tenant.id);
  }
});

test('registrar() (POST /api/vendas normal, sem opcoes): body.contingencia malicioso é ignorado — segurança contra forjar chaveNfce/xmlNfce numa venda online', async () => {
  const tenant = await criarTenant('05');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9801000000005', nome: 'Produto Cont 05', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  try {
    // Nota: SEM 5º argumento (opcoes) — exatamente como venda.controller.registrar chama.
    const venda = await vendaService.registrar(
      tenant.id,
      { itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }], contingencia: contingenciaAssinadaExemplo('41999999999999999999999999999999999999999999') },
      { id: 'usuario-teste' }, '127.0.0.1'
    );
    const registro = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(registro.statusEmissaoFiscal, 'nao_aplicavel', 'contingência forjada no body de uma venda ONLINE deve ser ignorada');
    assert.equal(registro.xmlNfce, null);
    assert.notEqual(registro.chaveNfce, '41999999999999999999999999999999999999999999');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('sync(): contingência assinada mas sem chaveAcesso/xmlAssinado é rejeitada com erro claro, sem persistir a venda', async () => {
  const tenant = await criarTenant('06');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9801000000006', nome: 'Produto Cont 06', preco: 10 } });
  await prisma.caixa.create({ data: { tenantId: tenant.id, valorAbertura: 0 } });
  const localId = 'local-cont-06';
  try {
    const resultados = await vendaService.sync(tenant.id, [
      {
        localId, itens: [{ produtoId: produto.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valor: 10 }],
        contingencia: { assinado: true }, // sem chaveAcesso/xmlAssinado
      },
    ]);
    assert.equal(resultados[0].status, 'erro');
    assert.match(resultados[0].mensagem, /chaveAcesso\/xmlAssinado/);
    const venda = await prisma.venda.findFirst({ where: { tenantId: tenant.id, localId } });
    assert.equal(venda, null, 'nenhuma venda deve ser persistida quando a contingência está malformada');
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
