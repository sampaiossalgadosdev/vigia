/**
 * Arquivo: pdvGateway.js
 * Responsabilidade: Servidor WebSocket em /ws/pdv para notificar os PDVs em
 * tempo real quando dados sincronizáveis mudarem (padrão "notifique e o
 * cliente rebusca": o evento não carrega dados, o PDV refaz o GET de sync).
 * Autenticação: mesmo accessToken JWT do contexto tenant, via query string
 * (?token=...). Conexões ficam associadas ao tenant do token; eventos de um
 * tenant nunca são enviados a conexões de outro tenant.
 * Utilizado por: server.js (init) e services que mutam dados sincronizáveis
 * (notificarSync).
 * Depende de: ws, utils/jwt, config/database, logs/logger.
 */
const { WebSocketServer } = require('ws');
const { verificarAccessToken } = require('../utils/jwt');
const prisma = require('../config/database');
const logger = require('../logs/logger');

const PATH = '/ws/pdv';
const PING_INTERVALO_MS = 30_000;
// setTimeout satura em 2^31-1 ms (~24,8 dias); acima disso não agenda expiração
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// Close codes da aplicação (faixa 4000-4999)
const CLOSE_TOKEN_INVALIDO = 4401; // token ausente, inválido, expirado ou usuário inativo → PDV renova o token e reconecta
const CLOSE_TENANT_SUSPENSO = 4403; // tenant desativado → não adianta renovar token

// tenantId -> Set<WebSocket>
const conexoesPorTenant = new Map();

/**
 * Valida o accessToken (contexto tenant) e o usuário/tenant no banco,
 * como o middleware auth. Lança AuthWsError com o close code adequado.
 */
async function autenticar(token) {
  let decoded;
  try {
    decoded = verificarAccessToken(token, 'tenant');
  } catch (e) {
    throw new AuthWsError(CLOSE_TOKEN_INVALIDO, 'Token inválido ou expirado');
  }
  const usuario = await prisma.usuario.findUnique({
    where: { id: decoded.sub },
    include: { tenant: { select: { ativo: true } } },
  });
  if (!usuario || !usuario.ativo) throw new AuthWsError(CLOSE_TOKEN_INVALIDO, 'Usuário inválido ou inativo');
  if (!usuario.tenant.ativo) throw new AuthWsError(CLOSE_TENANT_SUSPENSO, 'Conta suspensa');
  return { tenantId: usuario.tenantId, exp: decoded.exp };
}

class AuthWsError extends Error {
  constructor(closeCode, message) {
    super(message);
    this.closeCode = closeCode;
  }
}

async function aoConectar(ws, token) {
  let sessao;
  try {
    if (!token) throw new AuthWsError(CLOSE_TOKEN_INVALIDO, 'Token não informado');
    sessao = await autenticar(token);
  } catch (e) {
    if (e instanceof AuthWsError) return ws.close(e.closeCode, e.message);
    logger.error('Erro ao autenticar conexão WS do PDV', { erro: e.message });
    return ws.close(1011, 'Erro interno'); // falha de infra: PDV reconecta com o mesmo token
  }

  const { tenantId } = sessao;
  if (!conexoesPorTenant.has(tenantId)) conexoesPorTenant.set(tenantId, new Set());
  conexoesPorTenant.get(tenantId).add(ws);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Política de expiração: o servidor fecha com 4401 quando o token expira;
  // o PDV renova o token e reconecta.
  const restanteMs = sessao.exp * 1000 - Date.now();
  let timerExpiracao = null;
  if (restanteMs <= MAX_TIMEOUT_MS) {
    timerExpiracao = setTimeout(() => ws.close(CLOSE_TOKEN_INVALIDO, 'Token expirado'), restanteMs);
  }

  ws.on('close', () => {
    if (timerExpiracao) clearTimeout(timerExpiracao);
    const conexoes = conexoesPorTenant.get(tenantId);
    if (conexoes) {
      conexoes.delete(ws);
      if (conexoes.size === 0) conexoesPorTenant.delete(tenantId);
    }
  });

  logger.info('PDV conectado via WebSocket', { tenantId });
}

/**
 * Liga o gateway ao servidor HTTP existente (mesmo host/porta da API).
 */
function init(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'ws://localhost');
    if (url.pathname !== PATH) return socket.destroy();
    // Completa o handshake antes de autenticar, para o cliente receber o
    // close code (uma recusa no upgrade viraria erro genérico no PDV).
    wss.handleUpgrade(req, socket, head, (ws) => {
      aoConectar(ws, url.searchParams.get('token'));
    });
  });

  // Keep-alive: ping de protocolo a cada 30s; conexão que não respondeu o
  // pong do ciclo anterior é derrubada.
  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, PING_INTERVALO_MS);
  wss.on('close', () => clearInterval(pingTimer));

  logger.info(`Gateway WebSocket do PDV escutando em ${PATH}`);
}

/**
 * Notifica todas as conexões do tenant que um recurso mudou.
 * O evento não carrega dados: o PDV refaz o GET /api/sync/<recurso>.
 * Nunca lança — falha de notificação não pode quebrar a mutação que a gerou.
 */
function notificarSync(tenantId, recurso) {
  const conexoes = conexoesPorTenant.get(tenantId);
  if (!conexoes) return;
  const mensagem = JSON.stringify({ tipo: 'sync', recurso });
  for (const ws of conexoes) {
    if (ws.readyState === ws.OPEN) {
      ws.send(mensagem, (err) => {
        if (err) logger.warn('Falha ao notificar PDV via WebSocket', { tenantId, erro: err.message });
      });
    }
  }
}

module.exports = { init, notificarSync, PATH };
