/**
 * Arquivo: auth-rede.js
 * Responsabilidade: Login/logout/verificação de sessão do superusuário e
 * montagem da sidebar do painel de rede.
 */
const AuthRede = (() => {
  async function login(email, senha) {
    const resp = await fetch('/api/rede/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.message || 'Falha no login');
    ApiRede.setToken(json.data.accessToken);
    localStorage.setItem('rede_usuario', JSON.stringify(json.data.superusuario));
    return json.data.superusuario;
  }

  function logout() {
    ApiRede.limpar();
    window.location.href = '/rede/login.html';
  }

  function exigirLogin() {
    if (!ApiRede.getToken()) { window.location.href = '/rede/login.html'; return null; }
    try { return JSON.parse(localStorage.getItem('rede_usuario')); } catch (e) { return null; }
  }

  function montarSidebar(paginaAtiva) {
    const el = document.getElementById('sidebar');
    if (!el) return;
    const links = [
      ['index.html', 'Minhas lojas'],
      ['comparativo.html', 'Comparativo'],
    ];
    el.innerHTML =
      '<div class="logo">VIGIA<small>Painel da Rede</small></div>' +
      '<nav>' +
      links.map(([href, rotulo]) =>
        '<a href="/rede/' + href + '" class="' + (href === paginaAtiva ? 'ativo' : '') + '">' + rotulo + '</a>'
      ).join('') +
      '</nav>';

    const topo = document.getElementById('usuarioArea');
    const usuario = (() => { try { return JSON.parse(localStorage.getItem('rede_usuario')); } catch (e) { return null; } })();
    if (topo && usuario)
      topo.innerHTML = '<span>' + usuario.nome + '</span>' +
        '<button class="btn secundario pequeno" onclick="AuthRede.logout()">Sair</button>';
  }

  return { login, logout, exigirLogin, montarSidebar };
})();
