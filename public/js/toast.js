/**
 * Arquivo: toast.js
 * Responsabilidade: Exibir mensagens de feedback rápidas e temporárias
 * (sucesso/erro) sem depender do alert() nativo.
 * Utilizado por: manutencao-produtos.html, produtos-lote.html (e outras
 * páginas que precisarem de feedback no futuro). Incluído em todas as
 * páginas do tenant porque a navegação da sidebar troca só o <main> e
 * não recarrega <script src> — a função precisa já existir na origem.
 * Depende de: nenhuma lib externa; CSS próprio em app.css (seção Toast).
 */
function mostrarToast(mensagem, tipo = 'sucesso', duracaoMs = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + tipo;
  toast.textContent = mensagem;
  document.body.appendChild(toast);

  // força reflow pra garantir que a transição de entrada rode
  requestAnimationFrame(() => toast.classList.add('toast-visivel'));

  setTimeout(() => {
    toast.classList.remove('toast-visivel');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duracaoMs);
}

window.mostrarToast = mostrarToast;
