/**
 * Arquivo: api.js
 * Responsabilidade: Fetch wrapper do contexto tenant. Mantém o access token
 * em memória (variável JS), renova automaticamente com o refresh token do
 * localStorage (chave refresh_token) e anexa o Bearer em toda chamada.
 */
const API = (() => {
  let accessToken = null;

  function setAccessToken(token) { accessToken = token; }
  function getAccessToken() { return accessToken; }

  /**
   * Tenta renovar o par de tokens usando o refresh token salvo.
   * Retorna true se conseguiu.
   */
  async function renovar() {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) return false;
    try {
      const resp = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!resp.ok) { localStorage.removeItem('refresh_token'); return false; }
      const json = await resp.json();
      accessToken = json.data.accessToken;
      localStorage.setItem('refresh_token', json.data.refreshToken);
      if (json.data.usuario) localStorage.setItem('usuario', JSON.stringify(json.data.usuario));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Chamada autenticada. Em 401, tenta renovar uma vez e repete;
   * se falhar, redireciona para o login.
   */
  async function request(caminho, opcoes = {}, jaTentou = false) {
    const headers = opcoes.headers ? { ...opcoes.headers } : {};
    if (!(opcoes.body instanceof FormData) && opcoes.body !== undefined)
      headers['Content-Type'] = 'application/json';
    if (accessToken) headers['Authorization'] = 'Bearer ' + accessToken;

    const resp = await fetch(caminho, { ...opcoes, headers });

    if (resp.status === 401 && !jaTentou) {
      const renovou = await renovar();
      if (renovou) return request(caminho, opcoes, true);
      window.location.href = '/login.html';
      throw new Error('Sessão expirada');
    }

    const tipo = resp.headers.get('content-type') || '';
    if (!tipo.includes('application/json')) {
      if (!resp.ok) throw new Error('Falha na requisição (' + resp.status + ')');
      return resp.blob();
    }
    const json = await resp.json();
    if (!json.success) {
      const erro = new Error(json.message || 'Erro na requisição');
      erro.errors = json.errors || [];
      erro.status = resp.status;
      throw erro;
    }
    return json.data;
  }

  const get = (caminho) => request(caminho);
  const post = (caminho, body) => request(caminho, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) });
  const put = (caminho, body) => request(caminho, { method: 'PUT', body: JSON.stringify(body || {}) });
  const patch = (caminho, body) => request(caminho, { method: 'PATCH', body: JSON.stringify(body || {}) });
  const del = (caminho) => request(caminho, { method: 'DELETE' });

  return { request, get, post, put, patch, del, renovar, setAccessToken, getAccessToken };
})();
