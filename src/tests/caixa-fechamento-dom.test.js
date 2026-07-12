/**
 * Arquivo: caixa-fechamento-dom.test.js
 * Responsabilidade: Regressão do fechamento de caixa "cego" (Fase 4a,
 * Tarefa B) — verificação real de DOM (via jsdom), não só análise estática
 * do texto do arquivo. Carrega public/caixa.html, executa o script inline
 * de verdade (com API/UI/Auth stubados) e confirma que, no instante em que
 * o modal de contagem está aberto, o valor do sistema (totalVendas) não
 * está em NENHUM lugar do markup renderizado — nem escondido por CSS, nem
 * só fora de vista: o dado é removido do elemento, não só ocultado.
 * Uso: node --test src/tests/caixa-fechamento-dom.test.js
 * Depende de: jsdom (devDependency). Não usa banco de dados.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const CAIXA_HTML_PATH = path.join(__dirname, '..', '..', 'public', 'caixa.html');
const VALOR_SISTEMA = 555.3; // valor "secreto" que não pode aparecer no DOM durante a contagem
const VALOR_SISTEMA_FORMATADO = 'R$ 555,30';

function extrairScriptInline(html) {
  // O script inline é o último <script>...</script> antes de </body> (os
  // demais têm atributo src e são bibliotecas externas, não executadas aqui).
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (!blocos.length) throw new Error('Não encontrei o <script> inline em caixa.html');
  return blocos[blocos.length - 1][1];
}

function htmlSemScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<script[^>]*\/>/g, '');
}

/**
 * Monta um DOM real a partir do caixa.html de verdade, com API/UI/Auth
 * stubados (as bibliotecas reais fazem fetch/rede, o que não roda aqui) e
 * executa o script inline de verdade dentro dele.
 */
async function montarPagina({ totalVendasInicial = VALOR_SISTEMA } = {}) {
  const htmlOriginal = fs.readFileSync(CAIXA_HTML_PATH, 'utf8');
  const scriptInline = extrairScriptInline(htmlOriginal);
  const dom = new JSDOM(htmlSemScripts(htmlOriginal), { runScripts: 'outside-only', url: 'http://localhost/caixa.html' });
  const { window } = dom;

  const chamadasApi = [];
  window.initNavbar = () => {};
  window.mostrarToast = () => {};
  window.Auth = {
    exigirLogin: async () => ({ id: 'usuario-teste', nome: 'Teste' }),
    montarSidebar: async () => {},
  };
  window.UI = {
    moeda: (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','),
    data: (v) => String(v),
    escapar: (v) => String(v),
    limparErro: (el) => { el.textContent = ''; el.classList.remove('visivel'); },
    erro: (el, e) => { el.textContent = e && e.message ? e.message : String(e); el.classList.add('visivel'); },
    abrirModal: (id) => window.document.getElementById(id).classList.add('aberto'),
    fecharModal: (id) => window.document.getElementById(id).classList.remove('aberto'),
  };
  let caixaFechado = false;
  window.API = {
    get: async (caminho) => {
      chamadasApi.push({ metodo: 'GET', caminho });
      if (caminho.startsWith('/api/caixa/atual')) {
        return caixaFechado ? { status: 'fechado', mensagem: 'Nenhum caixa aberto' } : { status: 'aberto', totalVendas: totalVendasInicial };
      }
      if (caminho.startsWith('/api/caixa/historico')) return { items: [] };
      throw new Error('GET não esperado: ' + caminho);
    },
    post: async (caminho, body) => {
      chamadasApi.push({ metodo: 'POST', caminho, body });
      if (caminho === '/api/caixa/fechar') {
        caixaFechado = true;
        const valorFechamento = Number(body.valorFechamento);
        return { valorFechamento, totalVendas: totalVendasInicial, diferenca: valorFechamento - totalVendasInicial };
      }
      throw new Error('POST não esperado: ' + caminho);
    },
  };

  window.eval(scriptInline);
  // Deixa o IIFE de inicialização (Auth.exigirLogin → carregar()) assentar.
  await new Promise((resolve) => setTimeout(resolve, 30));

  return { dom, window, document: window.document, chamadasApi };
}

test('estado inicial da página: o valor do sistema aparece normalmente durante o expediente (fora do fluxo de fechamento)', async () => {
  const { document } = await montarPagina();
  assert.equal(document.getElementById('vendasDia').textContent, VALOR_SISTEMA_FORMATADO);
});

test('DOM real: ao abrir o modal de fechamento, o valor do sistema é REMOVIDO do elemento (não só escondido) e não aparece em nenhum lugar do markup renderizado', async () => {
  const { document } = await montarPagina();

  assert.equal(document.getElementById('vendasDia').textContent, VALOR_SISTEMA_FORMATADO, 'pré-condição: o valor deve estar visível antes de abrir o modal');

  document.getElementById('btnFecharCaixa').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));

  // O elemento que antes mostrava o valor tem que estar vazio de verdade —
  // não só escondido por CSS.
  assert.equal(document.getElementById('vendasDia').textContent, '', 'o valor deve ser removido do DOM, não só ocultado');

  // E o valor não pode aparecer em NENHUM lugar do HTML renderizado nesse
  // instante (nem em outro elemento, nem como atributo) — isso é o que
  // "Inspecionar elemento" veria.
  assert.doesNotMatch(document.body.innerHTML, /555,30/, 'o valor do sistema não pode aparecer em lugar nenhum do markup enquanto o modal de contagem está aberto');

  // O card continua oculto por CSS também (defesa em profundidade), mas o
  // ponto crítico acima é o dado ter saído do elemento.
  assert.equal(document.getElementById('cardVendasDia').style.display, 'none');
  assert.ok(document.getElementById('modalFechar').classList.contains('aberto'));
});

test('DOM real: cancelar o modal repõe o valor correto (nova busca), sem deixar residual do valor antigo escondido', async () => {
  const { document } = await montarPagina();

  document.getElementById('btnFecharCaixa').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.equal(document.getElementById('vendasDia').textContent, '');

  document.getElementById('btnCancelarFechar').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(document.getElementById('vendasDia').textContent, VALOR_SISTEMA_FORMATADO, 'ao cancelar, o valor deve voltar a aparecer (buscado de novo, não de uma variável guardada)');
  assert.equal(document.getElementById('cardVendasDia').style.display, '');
  assert.ok(!document.getElementById('modalFechar').classList.contains('aberto'));
});

test('DOM real: confirmar o fechamento só revela o valor do sistema (na etapa de resultado) depois do POST responder — nunca antes, e nunca no elemento vendasDia original', async () => {
  const { document, chamadasApi } = await montarPagina();

  document.getElementById('btnFecharCaixa').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  document.getElementById('f_valorContado').value = '540';
  document.getElementById('btnConfirmarFechar').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));

  const chamadaFechar = chamadasApi.find((c) => c.caminho === '/api/caixa/fechar');
  assert.ok(chamadaFechar, 'deve ter chamado POST /api/caixa/fechar');

  // Só agora, depois do POST, a comparação aparece — e só na etapa de
  // resultado do modal, nunca no card da página por trás.
  assert.equal(document.getElementById('resValorContado').textContent, 'R$ 540,00');
  assert.equal(document.getElementById('resValorSistema').textContent, VALOR_SISTEMA_FORMATADO);
  assert.equal(document.getElementById('resDiferenca').textContent, 'R$ -15,30');
  assert.equal(document.getElementById('vendasDia').textContent, '', 'o card original por trás do modal continua sem o valor até o modal ser concluído');

  document.getElementById('btnConcluirFechar').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(!document.getElementById('modalFechar').classList.contains('aberto'));
});
