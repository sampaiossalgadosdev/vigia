/**
 * Arquivo: role.js
 * Responsabilidade: Verificar se o perfil do usuário autenticado está entre
 * os perfis permitidos para a rota. Uso: role(['dono', 'gerente']).
 * Utilizado por: rotas do tenant após o middleware auth.
 */
const { error } = require('../utils/response');

function role(perfisPermitidos = []) {
  return (req, res, next) => {
    if (!req.usuario) return error(res, 'Não autenticado', [], 401);
    if (!perfisPermitidos.includes(req.usuario.perfil))
      return error(res, 'Você não tem permissão para esta ação', [], 403);
    return next();
  };
}

module.exports = { role };
