/**
 * Arquivo: modulos.js
 * Responsabilidade: Lista única dos módulos do sistema e níveis de permissão
 * válidos (espelha os enums ModuloSistema/NivelPermissao do schema).
 * Utilizado por: validators e services de Perfil.
 */
const MODULOS = ['dashboard', 'produtos', 'fornecedores', 'estoque', 'usuarios', 'perfis', 'vendas', 'promocoes', 'caixa', 'relatorios', 'ia', 'financeiro', 'assinatura_fiscal'];

const NIVEIS = ['acesso_completo', 'edicao_leitura', 'somente_insercao', 'somente_leitura', 'bloqueado'];

module.exports = { MODULOS, NIVEIS };
