/**
 * Arquivo: rateLimiter.js
 * Responsabilidade: Limitar tentativas de requisição por IP — login (os três
 * contextos: tenant, superadmin, rede) com limite estrito, já que senha
 * incorreta não deve custar nada além de tempo de rede pra quem tenta
 * adivinhar; e um limite geral, mais folgado, pro resto da API.
 * Utilizado por: auth.routes.js, superadmin.routes.js, rede.routes.js, server.js.
 */
const rateLimit = require('express-rate-limit');
const { error } = require('../utils/response');

const respostaLimite = (req, res) => error(res, 'Muitas tentativas, aguarde antes de tentar novamente', [], 429);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respostaLimite,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respostaLimite,
});

module.exports = { loginLimiter, apiLimiter };
