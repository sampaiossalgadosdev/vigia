/**
 * Arquivo: jwt.js
 * Responsabilidade: Geração e verificação de JWTs dos três contextos
 * (tenant, admin, rede) e do refresh token do tenant.
 * Utilizado por: services de auth e middlewares de autenticação.
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const authConfig = require('../config/auth');

const contextos = {
  tenant: { secret: authConfig.tenant.secret, expiresIn: authConfig.tenant.expiresIn },
  admin: { secret: authConfig.admin.secret, expiresIn: authConfig.admin.expiresIn },
  rede: { secret: authConfig.rede.secret, expiresIn: authConfig.rede.expiresIn },
};

/**
 * Gera um access token para o contexto informado (tenant | admin | rede).
 */
function gerarAccessToken(payload, contexto = 'tenant') {
  const cfg = contextos[contexto];
  return jwt.sign({ ...payload, tipo: contexto }, cfg.secret, { expiresIn: cfg.expiresIn });
}

/**
 * Verifica um access token do contexto informado. Lança se inválido/expirado.
 */
function verificarAccessToken(token, contexto = 'tenant') {
  const decoded = jwt.verify(token, contextos[contexto].secret);
  if (decoded.tipo !== contexto) throw new Error('Contexto de token inválido');
  return decoded;
}

/**
 * Gera um refresh token JWT com jti aleatório (usado como id no banco).
 */
function gerarRefreshToken(payload) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ ...payload, tipo: 'refresh' }, authConfig.tenant.refreshSecret, {
    expiresIn: authConfig.tenant.refreshExpiresIn,
    jwtid: jti,
  });
  return { token, jti };
}

/**
 * Verifica um refresh token. Lança se inválido/expirado.
 */
function verificarRefreshToken(token) {
  const decoded = jwt.verify(token, authConfig.tenant.refreshSecret);
  if (decoded.tipo !== 'refresh') throw new Error('Token não é um refresh token');
  return decoded;
}

module.exports = { gerarAccessToken, verificarAccessToken, gerarRefreshToken, verificarRefreshToken };
