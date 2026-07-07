/**
 * Arquivo: auth.js
 * Responsabilidade: Centralizar secrets e expirações de JWT dos três contextos
 * de autenticação (tenant, superadmin, superusuário/rede) e do refresh token.
 * Utilizado por: utils/jwt.js, middlewares de auth, services de auth.
 */
require('dotenv').config();

module.exports = {
  tenant: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  admin: {
    secret: process.env.JWT_ADMIN_SECRET,
    expiresIn: process.env.JWT_ADMIN_EXPIRES_IN || '4h',
  },
  rede: {
    secret: process.env.JWT_REDE_SECRET,
    expiresIn: process.env.JWT_REDE_EXPIRES_IN || '8h',
  },
  bcryptRounds: 10,
};
