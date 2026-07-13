/**
 * Arquivo: usuario.validator.js
 * Responsabilidade: Schemas de validação de criação e edição de usuário do tenant.
 * Utilizado por: usuario.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');

const criar = [
  body('nome').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Nome é obrigatório (2 a 120 caracteres)'),
  body('email').isEmail().withMessage('E-mail inválido'),
  body('senha').isString().isLength({ min: 8 }).withMessage('Senha deve ter no mínimo 8 caracteres'),
  body('perfilId').isString().notEmpty().withMessage('Perfil é obrigatório'),
  validar,
];

const atualizar = [
  body('nome').optional({ values: 'falsy' }).isString().trim().isLength({ min: 2, max: 120 }),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('E-mail inválido'),
  body('senha').optional({ values: 'falsy' }).isString().isLength({ min: 8 }).withMessage('Senha deve ter no mínimo 8 caracteres'),
  body('perfilId').optional({ values: 'falsy' }).isString().notEmpty().withMessage('Perfil inválido'),
  validar,
];

module.exports = { criar, atualizar };
