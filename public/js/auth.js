/**
 * Arquivo: auth.js
 * Responsabilidade: Login/logout/verificação de sessão do tenant, montagem da
 * sidebar com badge de sugestões pendentes e helpers de UI compartilhados.
 */
const Auth = (() => {
  /**
   * Faz login e armazena tokens (access em memória, refresh no localStorage).
   */
  async function login(email, senha) {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.message || 'Falha no login');
    API.setAccessToken(json.data.accessToken);
    localStorage.setItem('refresh_token', json.data.refreshToken);
    localStorage.setItem('usuario', JSON.stringify(json.data.usuario));
    return json.data.usuario;
  }

  async function logout() {
    const refreshToken = localStorage.getItem('refresh_token');
    try {
      if (refreshToken) await API.post('/api/auth/logout', { refreshToken });
    } catch (e) { /* segue o logout local mesmo assim */ }
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('usuario');
    API.setAccessToken(null);
    window.location.href = '/login.html';
  }

  /**
   * Exige sessão válida na página: sem access token, tenta renovar;
   * sem refresh válido, redireciona ao login.
   */
  async function exigirLogin() {
    if (!API.getAccessToken()) {
      const renovou = await API.renovar();
      if (!renovou) { window.location.href = '/login.html'; return null; }
    }
    return usuarioAtual();
  }

  function usuarioAtual() {
    try { return JSON.parse(localStorage.getItem('usuario')); } catch (e) { return null; }
  }

  async function carregarPagina(pagina) {
    const container = document.querySelector('main.conteudo');
    if (!container) return;

    const url = pagina === 'index.html' ? '/' : '/' + pagina;
    const parent = container.parentNode;
    container.innerHTML = '<div class="vazio">Carregando...</div>';

    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error('Falha ao carregar a página');
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const main = doc.querySelector('main.conteudo');
      if (!main) throw new Error('Estrutura de página inválida');

      const clone = main.cloneNode(true);
      parent.replaceChild(clone, container);

      // Remove conteúdo dinâmico da navegação anterior (modais e script da página).
      document.querySelectorAll('[data-dynamic]').forEach((el) => el.remove());

      // Reproduz elementos fora do <main> (ex.: modais), que não fazem parte
      // do layout fixo e por isso não são trazidos ao trocar só o <main>.
      Array.from(doc.body.children).forEach((el) => {
        if (el.tagName === 'SCRIPT' || el.classList.contains('layout')) return;
        const extra = el.cloneNode(true);
        extra.setAttribute('data-dynamic', 'true');
        document.body.appendChild(extra);
      });

      // Só reexecuta o script inline da própria página. navbar.js/api.js/auth.js
      // usam const no escopo global e já estão carregados: reinjetá-los quebra
      // a página com "Identifier já foi declarado".
      Array.from(doc.querySelectorAll('script')).forEach((script) => {
        if (script.src) return;
        const novo = document.createElement('script');
        novo.setAttribute('data-dynamic', 'true');
        novo.textContent = script.textContent;
        document.body.appendChild(novo);
      });

      const target = pagina === 'index.html' ? '/' : '/' + pagina;
      history.pushState({ page: pagina }, '', target);
    } catch (e) {
      container.innerHTML = '<div class="vazio">Não foi possível carregar esta página.</div>';
    }
  }

  /**
   * Um módulo aparece no menu se o usuário for Dono, ou se o Perfil dele
   * tiver qualquer nível de permissão diferente de "bloqueado" nesse módulo.
   */
  function temAcessoAoModulo(usuario, modulo) {
    if (!usuario) return false;
    if (usuario.isDono) return true;
    const nivel = (usuario.permissoes || {})[modulo];
    return !!nivel && nivel !== 'bloqueado';
  }

  /**
   * Injeta a sidebar padrão, marca o link ativo, esconde módulos sem
   * permissão e busca o badge de sugestões pendentes.
   * Itens com `filhos` viram um grupo expansível (dropdown): o rótulo só
   * abre/fecha o submenu, não navega — quem navega são os filhos.
   */
  async function montarSidebar(paginaAtiva) {
    const usuario = usuarioAtual();
    const el = document.getElementById('sidebar');
    if (!el) return;
    const links = [
      ['index.html', 'Dashboard', 'dashboard'],
      {
        rotulo: 'Produtos',
        modulo: 'produtos',
        filhos: [
          ['produtos.html', 'Listar Produtos'],
          ['produtos-lote.html', 'Alterar Produtos em Lote'],
          ['categorias-produtos.html', 'Categorias de Produtos'],
        ],
      },
      ['fornecedores.html', 'Fornecedores', 'fornecedores'],
      ['estoque.html', 'Estoque / NF-e', 'estoque'],
      ['nfe-entrada.html', 'NF-e de Entrada', 'estoque'],
      ['depositos.html', 'Depósitos', 'estoque'],
      ['inventario.html', 'Inventário', 'estoque'],
      ['vendas.html', 'Vendas', 'vendas'],
      ['promocoes.html', 'Promoções', 'promocoes'],
      ['acougue-tv.html', 'Açougue TV', 'produtos'],
      ['caixa.html', 'Caixa', 'caixa'],
      ['relatorios.html', 'Relatórios', 'relatorios'],
      ['ia.html', 'IA', 'ia'],
      ['usuarios.html', 'Usuários', 'usuarios'],
      ['perfis.html', 'Perfis', 'perfis'],
    ];

    const renderLink = (href, rotulo, submenu) => {
      const badge = href === 'index.html' ? ' <span id="badgeSugestoes" class="badge oculto"></span>' : '';
      return '<a href="/' + href + '" class="' + (href === paginaAtiva ? 'ativo' : '') + (submenu ? ' sublink' : '') + '" data-page="' + href + '">' + rotulo + badge + '</a>';
    };

    el.innerHTML =
      '<div class="logo">VIGIA<small>Varejo Inteligente</small></div>' +
      '<nav>' +
      links
        .filter((item) => temAcessoAoModulo(usuario, Array.isArray(item) ? item[2] : item.modulo))
        .map((item) => {
          if (Array.isArray(item)) return renderLink(item[0], item[1], false);
          const aberto = item.filhos.some(([href]) => href === paginaAtiva);
          return (
            '<div class="grupo-menu' + (aberto ? ' aberto' : '') + '">' +
            '<button type="button" class="grupo-toggle' + (aberto ? ' ativo' : '') + '">' +
            item.rotulo + ' <span class="grupo-seta">▸</span></button>' +
            '<div class="submenu">' +
            item.filhos.map(([href, rotulo]) => renderLink(href, rotulo, true)).join('') +
            '</div></div>'
          );
        })
        .join('') +
      '</nav>';

    el.querySelectorAll('.grupo-toggle').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('.grupo-menu').classList.toggle('aberto'));
    });

    el.querySelectorAll('a[data-page]').forEach((link) => {
      link.addEventListener('click', async (ev) => {
        const pagina = link.getAttribute('data-page');
        if (pagina) {
          ev.preventDefault();
          el.querySelectorAll('a[data-page]').forEach((item) => item.classList.remove('ativo'));
          link.classList.add('ativo');
          await carregarPagina(pagina);
        }
      });
    });

    const topo = document.getElementById('usuarioArea');
    if (topo && usuario) {
      topo.innerHTML = '<span>' + UI.escapar(usuario.nome) + ' · ' + (usuario.isDono ? 'Dono' : UI.escapar(usuario.perfilNome || 'usuário')) + '</span>' +
        '<button class="btn secundario pequeno" data-acao="sair">Sair</button>';
      topo.querySelector('[data-acao="sair"]').addEventListener('click', logout);
    }

    try {
      const data = await API.get('/api/sugestoes?limit=1');
      const badge = document.getElementById('badgeSugestoes');
      if (badge && data.pendentes > 0) {
        badge.textContent = data.pendentes;
        badge.classList.remove('oculto');
      }
    } catch (e) { /* badge é opcional */ }
  }

  window.carregarPagina = carregarPagina;
  window.addEventListener('popstate', (event) => {
    const page = event.state && event.state.page ? event.state.page : 'index.html';
    carregarPagina(page);
  });

  window.Auth = { login, logout, exigirLogin, usuarioAtual, montarSidebar };
  return { login, logout, exigirLogin, usuarioAtual, montarSidebar };
})();

/** Helpers globais de UI compartilhados pelas páginas. */
const UI = {
  moeda: (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','),
  numero: (v) => Number(v || 0).toLocaleString('pt-BR'),
  data: (v) => (v ? new Date(v).toLocaleString('pt-BR') : '-'),
  abrirModal: (id) => document.getElementById(id).classList.add('aberto'),
  fecharModal: (id) => document.getElementById(id).classList.remove('aberto'),
  escapar: (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),

  /**
   * Exibe uma mensagem de erro num elemento .msg-erro. Aceita uma string
   * simples ou o erro lançado por api.js (usa e.message + e.errors, quando houver).
   */
  erro: (el, mensagemOuErro) => {
    const texto = mensagemOuErro && mensagemOuErro.message
      ? mensagemOuErro.message + (mensagemOuErro.errors && mensagemOuErro.errors.length ? ': ' + mensagemOuErro.errors.join('; ') : '')
      : String(mensagemOuErro);
    el.textContent = texto;
    el.classList.add('visivel');
  },
  limparErro: (el) => el.classList.remove('visivel'),

  /**
   * Padrão dos botões "Excluir/Desativar": confirma com o usuário e executa
   * a ação; erro vira alert (essas ações não têm um painel de erro dedicado).
   */
  confirmarAcao: async (mensagem, acao) => {
    if (!confirm(mensagem)) return;
    try { await acao(); } catch (e) { alert(e.message); }
  },
};
