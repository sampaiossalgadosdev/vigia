/**
 * Arquivo: auth.js (middleware)
 * Responsabilidade: Validar o JWT do contexto tenant, verificar usuário e
 * tenant ativos no banco e injetar req.tenantId, req.tenant e req.usuario
 * (incluindo o mapa de permissões por módulo do Perfil do usuário, quando
 * não for Dono).
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
      include: {
        tenant: true,
        perfil: { include: { permissoes: true } },
      },
    });
    if (!usuario || !usuario.ativo) return error(res, 'Usuário inválido ou inativo', [], 401);
    if (!usuario.tenant.ativo)
      return error(res, 'Conta suspensa. Entre em contato com o suporte.', [], 403);

    const permissoes = {};
    if (usuario.perfil) {
      for (const p of usuario.perfil.permissoes) permissoes[p.modulo] = p.nivel;
    }

    req.tenantId = usuario.tenantId;
    req.tenant = { id: usuario.tenant.id, nome: usuario.tenant.nome, plano: usuario.tenant.plano };
    req.usuario = {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      tenantId: usuario.tenantId,
      isDono: usuario.isDono,
      perfilId: usuario.perfilId,
      perfilNome: usuario.isDono ? 'Dono' : usuario.perfil ? usuario.perfil.nome : null,
      permissoes,
    };
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { auth, extrairToken };
