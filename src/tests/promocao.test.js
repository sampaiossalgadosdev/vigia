/**
 * Arquivo: promocao.test.js
 * Responsabilidade: Regressão do incidente real em produção (POST
 * /api/promocoes, tela Promoções, 15/07/2026) — criação de promoção
 * respondia 500 "Erro interno do servidor" de forma intermitente. Causas
 * reais confirmadas via `railway logs`:
 *   1) produtoId chegava como o texto livre digitado no campo "Produto"
 *      (nunca um id de verdade — não havia busca/seleção de produto na
 *      tela), gerando violação de foreign key no Prisma.
 *   2) leveQtd/pagueQtd chegavam como string (valor bruto de <input
 *      type="number">), rejeitados pelo Prisma Client (espera Int|null).
 * Corrigido em promocoes.html (busca real de produto + Number() nos
 * campos numéricos) E em promocao.validator.js (defesa em profundidade:
 * qualquer chamador — inclusive futuro — que mande produtoId inválido ou
 * leveQtd/pagueQtd em formato errado agora recebe 422 claro, nunca mais
 * um 500 genérico).
 * Uso: node --test src/tests/promocao.test.js
 * Depende de: DATABASE_URL válido em .env (banco real via Prisma).
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const prisma = require('../config/database');
const promocaoService = require('../services/promocao.service');
const { criar: validarCriar } = require('../validators/promocao.validator');

// UUID v4 de verdade — um placeholder tipo "11111111-1111-1111-1111-..."
// falha isUUID() (nibble de versão/variante inválido), o que mascararia o
// que estes testes de validação realmente querem provar.
const UUID_TESTE = crypto.randomUUID();

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenant(sufixo) {
  return prisma.tenant.create({
    data: { nome: `Teste Promocao ${sufixo}`, cnpj: cnpjTeste(sufixo), email: `promocao-${sufixo}-${Date.now()}@teste.com` },
  });
}

async function limparTenant(tenantId) {
  await prisma.promocao.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.produto.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

/**
 * Executa a cadeia de validação real (express-validator) contra um body,
 * sem precisar subir um servidor HTTP — roda cada regra via .run(req) (API
 * pública do express-validator pra isso) e por fim a própria função
 * `validar`, capturando o que ela responderia via res.status().json().
 * Devolve { body: req.body já sanitizado, statusCode, payload }.
 */
async function rodarValidacao(cadeia, bodyOriginal) {
  const req = { body: { ...bodyOriginal } };
  let statusCode = 200;
  let payload = null;
  const res = {
    status(codigo) { statusCode = codigo; return this; },
    json(dados) { payload = dados; return this; },
  };
  for (const regra of cadeia) {
    if (typeof regra.run === 'function') await regra.run(req);
    else regra(req, res, () => {}); // a própria função `validar`, sempre a última
  }
  return { body: req.body, statusCode, payload };
}

test('buscarProdutos: encontra produto ativo por nome parcial e por EAN; ignora termo curto e produto inativo', async () => {
  const tenant = await criarTenant('01');
  try {
    await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000001', nome: 'Açúcar Refinado 1kg', preco: 5 } });
    await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000002', nome: 'Produto Inativo', preco: 5, ativo: false } });

    assert.deepEqual(await promocaoService.buscarProdutos(tenant.id, 'a'), [], 'termo com menos de 2 caracteres deve retornar vazio, sem consultar o banco');

    const porNome = await promocaoService.buscarProdutos(tenant.id, 'açúcar');
    assert.equal(porNome.length, 1);
    assert.equal(porNome[0].nome, 'Açúcar Refinado 1kg');

    const porEan = await promocaoService.buscarProdutos(tenant.id, '9980000000001');
    assert.equal(porEan.length, 1);
    assert.equal(porEan[0].id, porNome[0].id);

    assert.deepEqual(await promocaoService.buscarProdutos(tenant.id, 'Inativo'), [], 'produto inativo não deve aparecer na busca da promoção');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('REGRESSÃO (causa raiz #1 do incidente): produtoId que não é um id real (texto livre do campo, como no bug original) é rejeitado com 422 claro, nunca chega a bater no Prisma', async () => {
  const { statusCode, payload } = await rodarValidacao(validarCriar, {
    produtoId: 'Açúcar Refinado 1kg', // exatamente o valor visto no log de produção
    nome: 'Promoção', tipo: 'percentual', desconto: '50', dataInicio: '2026-07-15', dataFim: '2026-07-15',
    leveQtd: '1', pagueQtd: '1',
  });
  assert.equal(statusCode, 422, 'produtoId inválido deve virar 422 de validação, não 500');
  assert.ok(payload.errors.some((e) => /produto válido/i.test(e)), `esperava mensagem sobre produto válido, veio: ${JSON.stringify(payload.errors)}`);
});

test('REGRESSÃO (causa raiz #2 do incidente): leveQtd/pagueQtd enviados como string numérica ("1") são sanitizados para number — nunca mais chegam como string no Prisma', async () => {
  const { body, statusCode } = await rodarValidacao(validarCriar, {
    produtoId: UUID_TESTE,
    nome: 'Promoção', tipo: 'leve_pague', desconto: '0', dataInicio: '2026-07-15', dataFim: '2026-07-20',
    leveQtd: '1', pagueQtd: '2', // strings — exatamente o que a tela quebrada mandava
  });
  assert.equal(statusCode, 200, 'valores numéricos válidos (mesmo em string) devem passar na validação');
  assert.equal(body.leveQtd, 1);
  assert.equal(typeof body.leveQtd, 'number', 'leveQtd deve ser sanitizado para number — era o bug: Prisma rejeita string em campo Int');
  assert.equal(body.pagueQtd, 2);
  assert.equal(typeof body.pagueQtd, 'number');
  assert.equal(typeof body.desconto, 'number', 'desconto também deve ser sanitizado para number');
});

test('leveQtd/pagueQtd não numéricos (ex: "abc") são rejeitados com 422, não repassados adiante', async () => {
  const { statusCode, payload } = await rodarValidacao(validarCriar, {
    produtoId: UUID_TESTE,
    nome: 'Promoção', tipo: 'leve_pague', desconto: '0', dataInicio: '2026-07-15', dataFim: '2026-07-20',
    leveQtd: 'abc',
  });
  assert.equal(statusCode, 422);
  assert.ok(payload.errors.some((e) => /Leve qtd/i.test(e)));
});

test('leveQtd/pagueQtd ausentes (null) continuam válidos — tipo percentual/valor_fixo não precisa deles', async () => {
  const { statusCode, body } = await rodarValidacao(validarCriar, {
    produtoId: UUID_TESTE,
    nome: 'Promoção', tipo: 'percentual', desconto: '20', dataInicio: '2026-07-15', dataFim: '2026-07-20',
    leveQtd: null, pagueQtd: null,
  });
  assert.equal(statusCode, 200);
  assert.equal(body.leveQtd, null);
});

test('criar(): fluxo completo com produtoId real e leveQtd/pagueQtd como number (o que promocoes.html manda depois da correção) cria a promoção com sucesso', async () => {
  const tenant = await criarTenant('02');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000003', nome: 'Feijão Preto 1kg', preco: 8 } });
    const usuario = { id: 'usuario-teste' };

    const promocao = await promocaoService.criar(tenant.id, {
      produtoId: produto.id, nome: 'Promoção', tipo: 'leve_pague', desconto: 0,
      dataInicio: '2026-07-15', dataFim: '2026-07-20', leveQtd: 3, pagueQtd: 2,
    }, usuario, '127.0.0.1');

    assert.equal(promocao.produtoId, produto.id);
    assert.equal(promocao.leveQtd, 3);
    assert.equal(promocao.pagueQtd, 2);

    const lida = await prisma.promocao.findUnique({ where: { id: promocao.id } });
    assert.ok(lida, 'promoção deve estar persistida no banco');
  } finally {
    await limparTenant(tenant.id);
  }
});

test('criar(): produto com promoção ativa já existente é rejeitado com 409 (comportamento existente, sem regressão)', async () => {
  const tenant = await criarTenant('03');
  try {
    const produto = await prisma.produto.create({ data: { tenantId: tenant.id, ean: '9980000000004', nome: 'Arroz Branco 5kg', preco: 20 } });
    const usuario = { id: 'usuario-teste' };
    await promocaoService.criar(tenant.id, {
      produtoId: produto.id, nome: 'Promoção', tipo: 'percentual', desconto: 10,
      dataInicio: '2026-07-01', dataFim: '2026-12-31',
    }, usuario, '127.0.0.1');

    await assert.rejects(
      () => promocaoService.criar(tenant.id, {
        produtoId: produto.id, nome: 'Outra promoção', tipo: 'percentual', desconto: 15,
        dataInicio: '2026-07-01', dataFim: '2026-12-31',
      }, usuario, '127.0.0.1'),
      (erro) => { assert.equal(erro.status, 409); return true; }
    );
  } finally {
    await limparTenant(tenant.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
