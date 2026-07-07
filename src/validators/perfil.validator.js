/**
 * Arquivo: perfil.validator.js
 * Responsabilidade: Schemas de validação de criação e edição de Perfil.
 * Utilizado por: perfil.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');
const { MODULOS, NIVEIS } = require('../utils/modulos');

const permissoesValidas = (permissoes) => {
  if (permissoes === undefined) return true;
  if (!Array.isArray(permissoes)) throw new Error('permissoes deve ser uma lista');
  for (const p of permissoes) {
    if (!MODULOS.includes(p.modulo)) throw new Error(`Módulo inválido: ${p.modulo}`);
    if (!NIVEIS.includes(p.nivel)) throw new Error(`Nível de permissão inválido: ${p.nivel}`);
  }
  return true;
};

const criar = [
  body('nome').isString().trim().isLength({ min: 2, max: 80 }).withMessage('Nome é obrigatório (2 a 80 caracteres)'),
  body('descricao').optional({ values: 'falsy' }).isString().trim().isLength({ max: 255 }),
  body('permissoes').optional().custom(permissoesValidas),
  validar,
];

const atualizar = [
  body('nome').optional({ values: 'falsy' }).isString().trim().isLength({ min: 2, max: 80 }),
  body('descricao').optional({ values: 'falsy' }).isString().trim().isLength({ max: 255 }),
  body('permissoes').optional().custom(permissoesValidas),
  validar,
];

module.exports = { criar, atualizar };
