/**
 * Arquivo: permissao.middleware.js
 * Responsabilidade: Bloquear requisições de usuários sem permissão suficiente
 * no módulo da rota, de acordo com o método HTTP. O Dono (isDono) sempre
 * passa. Para os demais, usa o mapa de permissões já carregado em
 * req.usuario.permissoes pelo middleware auth (sem consulta extra ao banco).
 * Utilizado por: rotas do tenant (produtos, fornecedores, estoque, vendas,
 * promoções, relatórios, ia, usuários, perfis).
 * Depende de: req.usuario (setado pelo middleware auth).
 */
const { error } = require('../utils/response');

const NIVEIS_POR_METODO = {
  GET: ['acesso_completo', 'edicao_leitura', 'somente_insercao', 'somente_leitura'],
  POST: ['acesso_completo', 'somente_insercao'],
  PUT: ['acesso_completo', 'edicao_leitura'],
  PATCH: ['acesso_completo', 'edicao_leitura'],
  DELETE: ['acesso_completo'],
};

function exigePermissao(modulo) {
  return (req, res, next) => {
    if (!req.usuario) return error(res, 'Não autenticado', [], 401);
    if (req.usuario.isDono) return next();

    const nivel = (req.usuario.permissoes || {})[modulo];
    const niveisPermitidos = NIVEIS_POR_METODO[req.method] || [];

    if (!nivel || !niveisPermitidos.includes(nivel))
      return error(res, 'Você não tem permissão para esta ação', [], 403);
    return next();
  };
}

module.exports = { exigePermissao };
