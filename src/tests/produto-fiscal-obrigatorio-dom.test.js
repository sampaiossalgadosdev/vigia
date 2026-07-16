/**
 * Arquivo: produto-fiscal-obrigatorio-dom.test.js
 * Responsabilidade: Regressão de DOM real (via jsdom, mesmo padrão de
 * caixa-fechamento-dom.test.js) da exigência nova de classificação fiscal
 * completa — NCM/CFOP/CST-IBS-CBS/cClassTrib passam a ser obrigatórios em
 * produtos.html (modal de criação) e manutencao-produtos.html (edição).
 * Carrega as páginas de verdade, executa o script inline de verdade (com
 * API/UI/Auth stubados) e confirma que salvar SEM os 4 campos nunca chega
 * a chamar a API — o bloqueio acontece no cliente, antes do POST/PUT.
 * Uso: node --test src/tests/produto-fiscal-obrigatorio-dom.test.js
 * Depende de: jsdom (devDependency). Não usa banco de dados.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PRODUTOS_HTML_PATH = path.join(__dirname, '..', '..', 'public', 'produtos.html');
const MANUTENCAO_HTML_PATH = path.join(__dirname, '..', '..', 'public', 'manutencao-produtos.html');

const SUGESTOES = {
  ncm: [{ codigo: '01012100', descricao: 'Reprodutores de raça pura' }],
  cfop: [{ codigo: '5102', descricao: 'Venda de mercadoria adquirida ou recebida de terceiros' }],
  'cst-ibs-cbs': [{ codigo: '000', descricao: 'Tributação integral' }],
  'class-trib': [{ codigo: '000001', descricao: 'Situações tributadas integralmente pelo IBS e CBS.' }],
};

function extrairScriptInline(html) {
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (!blocos.length) throw new Error('Não encontrei o <script> inline');
  return blocos[blocos.length - 1][1];
}

function htmlSemScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<script[^>]*\/>/g, '');
}

function uiComum(document) {
  return {
    moeda: (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','),
    escapar: (v) => String(v),
    limparErro: (el) => { el.textContent = ''; el.classList.remove('visivel'); },
    erro: (el, e) => { el.textContent = e && e.message ? e.message : String(e); el.classList.add('visivel'); },
    abrirModal: (id) => document.getElementById(id) && document.getElementById(id).classList.add('aberto'),
    fecharModal: (id) => document.getElementById(id) && document.getElementById(id).classList.remove('aberto'),
    confirmarAcao: () => {},
  };
}

/**
 * Digita um termo de busca no seletor de catálogo, espera o debounce (300ms
 * em produção) resolver a busca stubada, e clica na sugestão retornada —
 * fluxo real de usuário, não atalho direto pro estado interno do seletor
 * (que é privado ao IIFE da página, inacessível daqui).
 */
async function selecionarCatalogo(document, inputId, sugestoesId) {
  const input = document.getElementById(inputId);
  input.value = 'x';
  input.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 350));
  const sugestao = document.querySelector('#' + sugestoesId + ' .sugestao[data-codigo]');
  if (!sugestao) throw new Error('Nenhuma sugestão renderizada em #' + sugestoesId);
  sugestao.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
}

async function montarProdutosHtml() {
  const htmlOriginal = fs.readFileSync(PRODUTOS_HTML_PATH, 'utf8');
  const scriptInline = extrairScriptInline(htmlOriginal);
  const dom = new JSDOM(htmlSemScripts(htmlOriginal), { runScripts: 'outside-only', url: 'http://localhost/produtos.html' });
  const { window } = dom;

  const chamadasApi = [];
  window.initNavbar = () => {};
  window.mostrarToast = () => {};
  window.Auth = { exigirLogin: async () => ({ id: 'usuario-teste' }), montarSidebar: async () => {} };
  window.UI = uiComum(window.document);
  window.API = {
    get: async (caminho) => {
      chamadasApi.push({ metodo: 'GET', caminho });
      if (caminho.startsWith('/api/produtos?')) return { items: [], total: 0, page: 1, totalPages: 1 };
      for (const chave of Object.keys(SUGESTOES))
        if (caminho.startsWith('/api/produtos/catalogos/' + chave + '?')) return SUGESTOES[chave];
      throw new Error('GET não esperado: ' + caminho);
    },
    post: async (caminho, body) => {
      chamadasApi.push({ metodo: 'POST', caminho, body });
      return { id: 'produto-novo', ...body };
    },
  };

  window.eval(scriptInline);
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { window, document: window.document, chamadasApi };
}

async function montarManutencaoHtml(produtoExistente) {
  const htmlOriginal = fs.readFileSync(MANUTENCAO_HTML_PATH, 'utf8');
  const scriptInline = extrairScriptInline(htmlOriginal);
  const dom = new JSDOM(htmlSemScripts(htmlOriginal), {
    runScripts: 'outside-only',
    url: 'http://localhost/manutencao-produtos.html?id=' + produtoExistente.id,
  });
  const { window } = dom;

  const chamadasApi = [];
  window.initNavbar = () => {};
  window.mostrarToast = () => {};
  window.Auth = { exigirLogin: async () => ({ id: 'usuario-teste' }), montarSidebar: async () => {} };
  window.UI = uiComum(window.document);
  window.API = {
    get: async (caminho) => {
      chamadasApi.push({ metodo: 'GET', caminho });
      if (caminho === '/api/produtos/' + produtoExistente.id) return produtoExistente;
      if (caminho === '/api/produtos/' + produtoExistente.id + '/ultima-compra') return { preco: null, fornecedor: null, data: null };
      if (caminho === '/api/produtos/categorias') return [{ id: 'categoria-teste', nome: 'Categoria Teste' }];
      for (const chave of Object.keys(SUGESTOES))
        if (caminho.startsWith('/api/produtos/catalogos/' + chave + '?')) return SUGESTOES[chave];
      throw new Error('GET não esperado: ' + caminho);
    },
    put: async (caminho, body) => {
      chamadasApi.push({ metodo: 'PUT', caminho, body });
      return { ...produtoExistente, ...body };
    },
  };

  window.eval(scriptInline);
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { window, document: window.document, chamadasApi };
}

test('produtos.html (criação): salvar com os 4 campos fiscais vazios é bloqueado no cliente — API.post nunca é chamada', async () => {
  const { document, chamadasApi } = await montarProdutosHtml();

  document.getElementById('btnNovoProduto').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  document.getElementById('f_ean').value = '9990000000001';
  document.getElementById('f_nome').value = 'Produto Teste DOM';
  document.getElementById('f_preco').value = '10';
  // NCM/CFOP/CST-IBS-CBS/cClassTrib ficam vazios de propósito.

  document.getElementById('btnSalvar').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.ok(!chamadasApi.some((c) => c.metodo === 'POST'), 'POST /api/produtos não pode ser chamado com campos fiscais vazios');
  assert.match(document.getElementById('erroModal').textContent, /NCM é obrigatório/);
});

test('produtos.html (criação): preenchendo os 4 campos fiscais via seleção real no catálogo (busca+clique), o salvar chega até a API com os códigos certos', async () => {
  const { document, chamadasApi } = await montarProdutosHtml();

  document.getElementById('btnNovoProduto').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  document.getElementById('f_ean').value = '9990000000002';
  document.getElementById('f_nome').value = 'Produto Teste DOM Completo';
  document.getElementById('f_preco').value = '10';

  await selecionarCatalogo(document, 'f_ncm', 'sugestoesNcm');
  await selecionarCatalogo(document, 'f_cfop', 'sugestoesCfop');
  await selecionarCatalogo(document, 'f_cstIbsCbs', 'sugestoesCstIbsCbs');
  await selecionarCatalogo(document, 'f_classTrib', 'sugestoesClassTrib');

  document.getElementById('btnSalvar').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  const chamadaPost = chamadasApi.find((c) => c.metodo === 'POST');
  assert.ok(chamadaPost, 'POST /api/produtos deveria ter sido chamado com os 4 campos preenchidos');
  assert.equal(chamadaPost.body.ncm, '01012100');
  assert.equal(chamadaPost.body.cfop, '5102');
  assert.equal(chamadaPost.body.cstIbsCbs, '000');
  assert.equal(chamadaPost.body.cClassTrib, '000001');
});

test('manutencao-produtos.html (edição): produto antigo que já tem NCM/CFOP/cstIbsCbs mas NUNCA teve cClassTrib preenchido — salvar (mesmo só mudando o preço) é bloqueado no cliente até completar o campo faltante', async () => {
  const produtoAntigo = {
    id: 'produto-antigo-1', ean: '9990000000003', nome: 'Produto Antigo', preco: 10,
    categoriaId: 'categoria-teste',
    ncm: '01012100', cfop: '5102', cstIbsCbs: '000', cClassTrib: null, // exatamente o efeito colateral aceito pelo usuário
    unidade: 'UN', estoqueQtd: 5,
  };
  const { document, chamadasApi } = await montarManutencaoHtml(produtoAntigo);

  document.getElementById('m_precoVenda').value = '12'; // só muda o preço
  document.getElementById('btnSalvar').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.ok(!chamadasApi.some((c) => c.metodo === 'PUT'), 'PUT não pode ser chamado enquanto cClassTrib estiver vazio');
  assert.match(document.getElementById('erroGeral').innerHTML, /cClassTrib é obrigatório/);
});

test('manutencao-produtos.html (edição): produto já com os 4 campos fiscais completos — mudar só o preço salva normalmente (caso comum não trava)', async () => {
  const produtoCompleto = {
    id: 'produto-completo-1', ean: '9990000000004', nome: 'Produto Completo', preco: 10,
    categoriaId: 'categoria-teste',
    ncm: '01012100', cfop: '5102', cstIbsCbs: '000', cClassTrib: '000001',
    unidade: 'UN', estoqueQtd: 5,
  };
  const { document, chamadasApi } = await montarManutencaoHtml(produtoCompleto);

  document.getElementById('m_precoVenda').value = '12';
  document.getElementById('btnSalvar').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  const chamadaPut = chamadasApi.find((c) => c.metodo === 'PUT');
  assert.ok(chamadaPut, 'PUT deveria ter sido chamado — os 4 campos já estavam completos, só o preço mudou');
  assert.equal(chamadaPut.body.preco, '12');
  assert.equal(chamadaPut.body.cClassTrib, '000001');
});
