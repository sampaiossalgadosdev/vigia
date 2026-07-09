/**
 * Arquivo: categoria.validator.js
 * Responsabilidade: Schemas de validação de criação e edição de categoria
 * (grupo/subgrupo). Utilizado por: categoria.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');

const regras = (opcional) => [
  (opcional
    ? body('nome').optional({ values: 'falsy' })
    : body('nome'))
    .isString().trim().isLength({ min: 2, max: 100 })
    .withMessage('Descrição deve ter entre 2 e 100 caracteres'),
  body('markupPercent').optional({ values: 'null' })
    .isFloat({ min: 0, max: 999.99 })
    .withMessage('Markup deve ser um percentual entre 0 e 999,99'),
  body('parentId').optional({ values: 'falsy' }).isUUID().withMessage('parentId inválido'),
];

const criar = [...regras(false), validar];
const atualizar = [...regras(true), validar];

module.exports = { criar, atualizar };
