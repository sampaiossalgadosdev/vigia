/**
 * Arquivo: authAdmin.js
 * Responsabilidade: Validar o JWT do contexto superadmin e injetar req.superadmin.
 * Utilizado por: rotas /api/superadmin (exceto login).
 * Depende de: utils/jwt, config/database.
 */
const { verificarAccessToken } = require('../utils/jwt');
const prisma = require('../config/database');
const { error } = require('../utils/response');
const { extrairToken } = require('./auth');

async function authAdmin(req, res, next) {
  try {
    const token = extrairToken(req);
    if (!token) return error(res, 'Token não informado', [], 401);

    let decoded;
    try {
      decoded = verificarAccessToken(token, 'admin');
    } catch (e) {
      return error(res, 'Token inválido ou expirado', [], 401);
    }

    const superadmin = await prisma.superadmin.findUnique({ where: { id: decoded.sub } });
    if (!superadmin || !superadmin.ativo) return error(res, 'Superadmin inválido ou inativo', [], 401);

    req.superadmin = { id: superadmin.id, nome: superadmin.nome, email: superadmin.email };
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { authAdmin };
