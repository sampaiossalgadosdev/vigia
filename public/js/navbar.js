(function () {
  function lerUsuario() {
    try {
      return JSON.parse(localStorage.getItem('usuario') || 'null');
    } catch (e) {
      return null;
    }
  }

  function lerTenant(usuario) {
    if (!usuario) return '';
    return usuario.tenant?.nome || usuario.tenantName || usuario.tenant?.name || '';
  }

  function lerNomeUsuario(usuario) {
    if (!usuario) return 'Usuário';
    return usuario.nome || usuario.name || 'Usuário';
  }

  function lerPerfil(usuario) {
    if (!usuario) return 'usuário';
    if (usuario.isDono) return 'Dono';
    return usuario.perfilNome || usuario.perfil || usuario.role || 'usuário';
  }

  /** Painel da Rede só é oferecido ao Dono de um tenant no plano pro. */
  function podeAcessarRede(usuario) {
    return !!(usuario && usuario.isDono && usuario.tenant && usuario.tenant.plano === 'pro');
  }

  async function acessarPainelDaRede() {
    try {
      const data = await window.API.post('/api/rede/sso', {});
      localStorage.setItem('rede_token', data.accessToken);
      localStorage.setItem('rede_usuario', JSON.stringify(data.superusuario));
      window.location.href = '/rede/index.html';
    } catch (e) {
      alert(e.message || 'Não foi possível acessar o Painel da Rede');
    }
  }

  function garantirNavbar() {
    if (document.getElementById('vigiaNavbar')) return document.getElementById('vigiaNavbar');

    const navbar = document.createElement('div');
    navbar.id = 'vigiaNavbar';
    navbar.className = 'navbar-topo';
    navbar.innerHTML = [
      '<div class="navbar-brand">',
      '<span class="navbar-brand-title" id="navbarTenant"></span>',
      '</div>',
      '<div class="navbar-user">',
      '<span class="navbar-user-name" id="navbarUserName">Usuário</span>',
      '<span class="navbar-user-profile" id="navbarUserProfile">usuário</span>',
      '<button type="button" class="btn secundario pequeno" id="navbarLogout">Sair</button>',
      '</div>'
    ].join('');

    document.body.insertBefore(navbar, document.body.firstChild);
    return navbar;
  }

  function garantirToggleSidebar() {
    if (document.getElementById('navbarToggle')) return document.getElementById('navbarToggle');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'navbarToggle';
    toggle.className = 'sidebar-toggle';
    toggle.setAttribute('aria-label', 'Alternar sidebar');
    toggle.innerHTML = '<span class="navbar-toggle-icon">☰</span>';

    document.body.insertBefore(toggle, document.body.firstChild);
    return toggle;
  }

  function atualizarEstadoToggle() {
    const btn = document.getElementById('navbarToggle');
    if (!btn) return;
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.querySelector('.navbar-toggle-icon').textContent = collapsed ? '☰' : '←';
  }

  function alternarSidebar() {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('vigia.sidebarCollapsed', collapsed ? '1' : '0');
    atualizarEstadoToggle();
  }

  function sincronizarEstadoSidebar() {
    const saved = localStorage.getItem('vigia.sidebarCollapsed');
    const collapsed = saved === '1';
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    atualizarEstadoToggle();
  }

  function preencherDados(usuario) {
    const navbar = garantirNavbar();
    if (!navbar) return;
    const tenant = document.getElementById('navbarTenant');
    const userName = document.getElementById('navbarUserName');
    const userProfile = document.getElementById('navbarUserProfile');

    if (tenant) tenant.textContent = lerTenant(usuario);
    if (userName) userName.textContent = lerNomeUsuario(usuario);
    if (userProfile) userProfile.textContent = lerPerfil(usuario);

    // O botão só é criado no DOM quando o usuário tem direito de acesso —
    // não é apenas escondido via CSS.
    const redeBtnExistente = document.getElementById('navbarRede');
    if (podeAcessarRede(usuario)) {
      if (!redeBtnExistente) {
        const redeBtn = document.createElement('button');
        redeBtn.type = 'button';
        redeBtn.id = 'navbarRede';
        redeBtn.className = 'btn secundario pequeno';
        redeBtn.textContent = 'Painel da Rede';
        redeBtn.addEventListener('click', acessarPainelDaRede);
        document.getElementById('navbarLogout').insertAdjacentElement('beforebegin', redeBtn);
      }
    } else if (redeBtnExistente) {
      redeBtnExistente.remove();
    }
  }

  function ligarEventos() {
    const toggle = document.getElementById('navbarToggle');
    if (toggle && !toggle.dataset.bound) {
      toggle.addEventListener('click', alternarSidebar);
      toggle.dataset.bound = 'true';
    }

    const logout = document.getElementById('navbarLogout');
    if (logout && !logout.dataset.bound) {
      logout.addEventListener('click', () => {
        if (window.Auth && typeof window.Auth.logout === 'function') {
          window.Auth.logout();
        } else {
          window.location.href = '/login.html';
        }
      });
      logout.dataset.bound = 'true';
    }
  }

  function initNavbar() {
    const usuario = lerUsuario();
    garantirNavbar();
    garantirToggleSidebar();
    preencherDados(usuario);
    sincronizarEstadoSidebar();
    ligarEventos();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavbar);
  } else {
    initNavbar();
  }

  window.initNavbar = initNavbar;
  window.Navbar = { initNavbar };
})();
