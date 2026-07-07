(function () {
  function lerUsuario() {
    try {
      return JSON.parse(localStorage.getItem('usuario') || 'null');
    } catch (e) {
      return null;
    }
  }

  function lerTenant(usuario) {
    if (!usuario) return 'VIGIA';
    return usuario.tenant?.nome || usuario.tenantName || usuario.tenant?.name || 'VIGIA';
  }

  function lerNomeUsuario(usuario) {
    if (!usuario) return 'Usuário';
    return usuario.nome || usuario.name || 'Usuário';
  }

  function lerPerfil(usuario) {
    if (!usuario) return 'usuário';
    return usuario.perfil || usuario.role || 'usuário';
  }

  function garantirNavbar() {
    if (document.getElementById('vigiaNavbar')) return document.getElementById('vigiaNavbar');

    const navbar = document.createElement('div');
    navbar.id = 'vigiaNavbar';
    navbar.className = 'navbar-topo';
    navbar.innerHTML = [
      '<button type="button" class="navbar-toggle" id="navbarToggle" aria-label="Alternar sidebar">',
      '<span class="navbar-toggle-icon">☰</span>',
      '</button>',
      '<div class="navbar-brand">',
      '<span class="navbar-brand-title" id="navbarTenant">VIGIA</span>',
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
