/**
 * Arquivo: authRede.js
 * Responsabilidade: Validar o JWT do contexto superusuário (rede) e injetar
 * req.superusuario com a lista de tenantIds atrelados.
 * Utilizado por: rotas /api/rede (exceto login).
 * Depende de: utils/jwt, config/database.
 */
const { verificarAccessToken } = require('../utils/jwt');
const prisma = require('../config/database');
const { error } = require('../utils/response');
const { extrairToken } = require('./auth');

async function authRede(req, res, next) {
  try {
    const token = extrairToken(req);
    if (!token) return error(res, 'Token não informado', [], 401);

    let decoded;
    try {
      decoded = verificarAccessToken(token, 'rede');
    } catch (e) {
      return error(res, 'Token inválido ou expirado', [], 401);
    }

    const superusuario = await prisma.superusuario.findUnique({
      where: { id: decoded.sub },
      include: { redes: { select: { tenantId: true } } },
    });
    if (!superusuario || !superusuario.ativo)
      return error(res, 'Superusuário inválido ou inativo', [], 401);

    req.superusuario = {
      id: superusuario.id,
      nome: superusuario.nome,
      email: superusuario.email,
      tenantIds: superusuario.redes.map((r) => r.tenantId),
    };
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { authRede };
