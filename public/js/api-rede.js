/**
 * Arquivo: api-rede.js
 * Responsabilidade: Fetch wrapper do contexto superusuário (rede). O token
 * fica no localStorage com a chave rede_token (JWT de 8h, sem refresh).
 */
const ApiRede = (() => {
  function getToken() { return localStorage.getItem('rede_token'); }
  function setToken(token) { localStorage.setItem('rede_token', token); }
  function limpar() { localStorage.removeItem('rede_token'); localStorage.removeItem('rede_usuario'); }

  async function request(caminho, opcoes = {}) {
    const headers = opcoes.headers ? { ...opcoes.headers } : {};
    if (opcoes.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const resp = await fetch(caminho, { ...opcoes, headers });
    if (resp.status === 401) {
      limpar();
      window.location.href = '/rede/login.html';
      throw new Error('Sessão expirada');
    }
    const json = await resp.json();
    if (!json.success) {
      const erro = new Error(json.message || 'Erro na requisição');
      erro.errors = json.errors || [];
      throw erro;
    }
    return json.data;
  }

  const get = (caminho) => request(caminho);
  const post = (caminho, body) => request(caminho, { method: 'POST', body: JSON.stringify(body) });

  return { request, get, post, getToken, setToken, limpar };
})();
