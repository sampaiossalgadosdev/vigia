/**
 * Arquivo: auth.js (middleware)
 * Responsabilidade: Validar o JWT do contexto tenant, verificar usuário e
 * tenant ativos no banco e injetar req.tenantId e req.usuario.
 * Utilizado por: rotas do tenant (produtos, fornecedores, estoque, usuários, sugestões).
 * Depende de: utils/jwt, config/database.
 */
const { verificarAccessToken } = require('../utils/jwt');
const prisma = require('../config/database');
const { error } = require('../utils/response');

/**
 * Extrai o token Bearer do header Authorization.
 */
function extrairToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

async function auth(req, res, next) {
  try {
    const token = extrairToken(req);
    if (!token) return error(res, 'Token não informado', [], 401);

    let decoded;
    try {
      decoded = verificarAccessToken(token, 'tenant');
    } catch (e) {
      return error(res, 'Token inválido ou expirado', [], 401);
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: decoded.sub },
      include: { tenant: true },
    });
    if (!usuario || !usuario.ativo) return error(res, 'Usuário inválido ou inativo', [], 401);
    if (!usuario.tenant.ativo)
      return error(res, 'Conta suspensa. Entre em contato com o suporte.', [], 403);

    req.tenantId = usuario.tenantId;
    req.usuario = {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      tenantId: usuario.tenantId,
    };
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { auth, extrairToken };
