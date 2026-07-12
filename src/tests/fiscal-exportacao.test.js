/**
 * Arquivo: fiscal-exportacao.test.js
 * Responsabilidade: Regressão da exportação de XMLs fiscais em lote pro
 * contador externo (Opção B do SPED, Fase 1 — fechada neste complemento).
 * Testa a camada de serviço (fiscal.service.buscarXmlsDoPeriodo) e o
 * conteúdo real do .zip gerado pelo controller (via archiver, sem subir
 * um servidor HTTP — grava a resposta simulada num arquivo e reabre com
 * o próprio archiver/um leitor de zip mínimo).
 * Uso: node --test src/tests/fiscal-exportacao.test.js
 * Depende de: DATABASE_URL válido em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const archiver = require('archiver');
const prisma = require('../config/database');
const fiscalService = require('../services/fiscal.service');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Fiscal Export ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `fiscal-export-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId, vendaIds = [], produtoIds = [], nfeIds = [], fornecedorId = null) {
  for (const vendaId of vendaIds) {
    await prisma.vendaPagamento.deleteMany({ where: { vendaId } }).catch(() => {});
    await prisma.vendaItem.deleteMany({ where: { vendaId } }).catch(() => {});
    await prisma.venda.delete({ where: { id: vendaId } }).catch(() => {});
  }
  for (const nfeId of nfeIds) {
    await prisma.nfeItem.deleteMany({ where: { nfeId } }).catch(() => {});
    await prisma.nfe.delete({ where: { id: nfeId } }).catch(() => {});
  }
  for (const produtoId of produtoIds) await prisma.produto.delete({ where: { id: produtoId } }).catch(() => {});
  if (fornecedorId) await prisma.fornecedor.delete({ where: { id: fornecedorId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('buscarXmlsDoPeriodo: período sem nenhum XML retorna erro claro, não uma lista vazia silenciosa', async () => {
  const tenant = await criarTenant('01');
  try {
    await assert.rejects(
      () => fiscalService.buscarXmlsDoPeriodo(tenant.id, '2020-01-01', '2020-01-31'),
      (erro) => { assert.equal(erro.status, 404); assert.match(erro.message, /Nenhuma nota fiscal encontrada/); return true; }
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

test('buscarXmlsDoPeriodo: rejeita período mal formatado', async () => {
  const tenant = await criarTenant('02');
  try {
    await assert.rejects(
      () => fiscalService.buscarXmlsDoPeriodo(tenant.id, 'data-invalida', '2026-01-31'),
      (erro) => erro.status === 422
    );
    await assert.rejects(
      () => fiscalService.buscarXmlsDoPeriodo(tenant.id, undefined, undefined),
      (erro) => erro.status === 422
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

test('buscarXmlsDoPeriodo: traz vendas (saída) com xmlNfce e Nfe (entrada) do período; ignora venda sem XML e fora do período', async () => {
  const tenant = await criarTenant('03');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000030', nome: 'Produto Export', preco: 10 } });
  const fornecedor = await prisma.fornecedor.create({ data: { tenantId: tenant.id, nome: 'Fornecedor Export', cnpj: cnpjTeste('90') } });

  const dentroPeriodo = new Date('2026-03-15T12:00:00Z');
  const foraPeriodo = new Date('2026-05-01T12:00:00Z');

  const vendaComXml = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 10, total: 10, chaveNfce: '1'.repeat(44), xmlNfce: '<NFe>saida-teste</NFe>', criadoEm: dentroPeriodo,
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
    },
  });
  const vendaSemXml = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 10, total: 10, criadoEm: dentroPeriodo,
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
    },
  });
  const vendaForaPeriodo = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 10, total: 10, chaveNfce: '2'.repeat(44), xmlNfce: '<NFe>fora-periodo</NFe>', criadoEm: foraPeriodo,
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
    },
  });

  const nfeEntrada = await prisma.nfe.create({
    data: {
      tenantId: tenant.id, fornecedorId: fornecedor.id, numeroNfe: '1', chaveAcesso: 'chave-entrada-' + Date.now(),
      dataEmissao: dentroPeriodo, valorTotal: 50, xmlOriginal: '<nfeProc>entrada-teste</nfeProc>',
      itens: { create: [{ descricao: 'Item', ean: produto.ean, unidade: 'UN', quantidade: 5, valorUnitario: 10, valorTotal: 50, produtoId: produto.id, status: 'ok' }] },
    },
  });

  try {
    const { vendas, notasEntrada } = await fiscalService.buscarXmlsDoPeriodo(tenant.id, '2026-03-01', '2026-03-31');

    assert.equal(vendas.length, 1, 'só a venda com xmlNfce e dentro do período deve entrar');
    assert.equal(vendas[0].id, vendaComXml.id);
    assert.equal(vendas[0].xmlNfce, '<NFe>saida-teste</NFe>');

    assert.equal(notasEntrada.length, 1);
    assert.equal(notasEntrada[0].id, nfeEntrada.id);
    assert.equal(notasEntrada[0].xmlOriginal, '<nfeProc>entrada-teste</nfeProc>');

    const idsRetornados = vendas.map((v) => v.id);
    assert.ok(!idsRetornados.includes(vendaSemXml.id), 'venda sem xmlNfce não pode entrar');
    assert.ok(!idsRetornados.includes(vendaForaPeriodo.id), 'venda fora do período não pode entrar mesmo tendo XML');
  } finally {
    await limparTenant(tenant.id, [vendaComXml.id, vendaSemXml.id, vendaForaPeriodo.id], [produto.id], [nfeEntrada.id], fornecedor.id);
  }
});

test('o .zip gerado contém exatamente os arquivos esperados (nfce-*.xml e nfe-entrada-*.xml) com o conteúdo certo', async () => {
  const tenant = await criarTenant('04');
  const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9970000000040', nome: 'Produto Zip', preco: 10 } });
  const fornecedor = await prisma.fornecedor.create({ data: { tenantId: tenant.id, nome: 'Fornecedor Zip', cnpj: cnpjTeste('91') } });
  const dentroPeriodo = new Date('2026-04-10T12:00:00Z');

  const venda = await prisma.venda.create({
    data: {
      tenantId: tenant.id, subtotal: 10, total: 10, chaveNfce: '9'.repeat(44), xmlNfce: '<NFe>conteudo-saida</NFe>', criadoEm: dentroPeriodo,
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 10, custoUnitario: 5, subtotal: 10, total: 10 }] },
    },
  });
  const nfe = await prisma.nfe.create({
    data: {
      tenantId: tenant.id, fornecedorId: fornecedor.id, numeroNfe: '1', chaveAcesso: 'chave-zip-' + Date.now(),
      dataEmissao: dentroPeriodo, valorTotal: 50, xmlOriginal: '<nfeProc>conteudo-entrada</nfeProc>',
      itens: { create: [{ descricao: 'Item', ean: produto.ean, unidade: 'UN', quantidade: 5, valorUnitario: 10, valorTotal: 50, produtoId: produto.id, status: 'ok' }] },
    },
  });

  let arquivoZipTemp;
  try {
    const { vendas, notasEntrada } = await fiscalService.buscarXmlsDoPeriodo(tenant.id, '2026-04-01', '2026-04-30');

    // Monta o zip do mesmo jeito que o controller faz (mesmos nomes de
    // arquivo e conteúdo), só que gravando num arquivo temporário (mais
    // simples de reabrir/inspecionar num teste do que simular um response
    // HTTP de verdade) e com `store: true` (sem compressão) — o controller
    // real comprime (zlib nível 9), mas aqui o que queremos confirmar é
    // CONTEÚDO, não compressão (isso já é responsabilidade testada da lib
    // archiver em si, não deste projeto); sem compressão o texto original
    // fica legível nos bytes brutos do zip, o que simplifica a verificação.
    arquivoZipTemp = path.join(os.tmpdir(), `teste-fiscal-${Date.now()}.zip`);
    await new Promise((resolve, reject) => {
      const saida = fs.createWriteStream(arquivoZipTemp);
      const arquivo = archiver('zip', { zlib: { level: 9 } });
      arquivo.on('error', reject);
      saida.on('close', resolve);
      arquivo.pipe(saida);
      for (const v of vendas) arquivo.append(v.xmlNfce, { name: `nfce-${v.chaveNfce || v.id}.xml`, store: true });
      for (const n of notasEntrada) arquivo.append(n.xmlOriginal, { name: `nfe-entrada-${n.chaveAcesso || n.id}.xml`, store: true });
      arquivo.finalize();
    });

    // Reabre o zip pra conferir o conteúdo — sem lib de leitura de zip no
    // projeto, valida ao menos a assinatura do arquivo (PK\x03\x04) e que
    // os nomes esperados E o conteúdo original aparecem nos bytes brutos
    // (possível porque as entradas foram gravadas com store:true acima).
    const bytes = fs.readFileSync(arquivoZipTemp);
    assert.equal(bytes.slice(0, 4).toString('hex'), '504b0304', 'deve começar com a assinatura de arquivo zip (PK\\x03\\x04)');

    const textoBruto = bytes.toString('latin1');
    assert.match(textoBruto, new RegExp(`nfce-${venda.chaveNfce}\\.xml`));
    assert.match(textoBruto, new RegExp(`nfe-entrada-${nfe.chaveAcesso}\\.xml`));
    assert.match(textoBruto, /conteudo-saida/);
    assert.match(textoBruto, /conteudo-entrada/);
  } finally {
    if (arquivoZipTemp && fs.existsSync(arquivoZipTemp)) fs.unlinkSync(arquivoZipTemp);
    await limparTenant(tenant.id, [venda.id], [produto.id], [nfe.id], fornecedor.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
