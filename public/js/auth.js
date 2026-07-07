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

  /**
   * Injeta a sidebar padrão, marca o link ativo, esconde módulos por perfil
   * e busca o badge de sugestões pendentes.
   */
  async function montarSidebar(paginaAtiva) {
    const usuario = usuarioAtual();
    const el = document.getElementById('sidebar');
    if (!el) return;
    const links = [
      ['index.html', 'Dashboard'],
      ['produtos.html', 'Produtos'],
      ['fornecedores.html', 'Fornecedores'],
      ['estoque.html', 'Estoque / NF-e'],
      ['vendas.html', 'Vendas'],
      ['promocoes.html', 'Promoções'],
      ['caixa.html', 'Caixa'],
      ['relatorios.html', 'Relatórios'],
      ['ia.html', 'IA'],
      ['usuarios.html', 'Usuários'],
    ];
    el.innerHTML =
      '<div class="logo">VIGIA<small>Varejo Inteligente</small></div>' +
      '<nav>' +
      links
        .filter(([href]) => href !== 'usuarios.html' || (usuario && usuario.perfil === 'dono'))
        .map(([href, rotulo]) => {
          const badge = href === 'index.html' ? ' <span id="badgeSugestoes" class="badge oculto"></span>' : '';
          return '<a href="/' + href + '" class="' + (href === paginaAtiva ? 'ativo' : '') + '">' + rotulo + badge + '</a>';
        })
        .join('') +
      '</nav>';

    const topo = document.getElementById('usuarioArea');
    if (topo && usuario)
      topo.innerHTML = '<span>' + usuario.nome + ' · ' + usuario.perfil + '</span>' +
        '<button class="btn secundario pequeno" onclick="Auth.logout()">Sair</button>';

    try {
      const data = await API.get('/api/sugestoes?limit=1');
      const badge = document.getElementById('badgeSugestoes');
      if (badge && data.pendentes > 0) {
        badge.textContent = data.pendentes;
        badge.classList.remove('oculto');
      }
    } catch (e) { /* badge é opcional */ }
  }

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
};
