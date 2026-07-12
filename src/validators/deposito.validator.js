/**
 * Arquivo: deposito.validator.js
 * Responsabilidade: Schema de validação de criação de depósito.
 * Utilizado por: deposito.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');

const criar = [
  body('nome').isString().trim().isLength({ min: 2, max: 100 })
    .withMessage('Nome deve ter entre 2 e 100 caracteres'),
  validar,
];

// `principal` propositalmente não tem regra aqui: qualquer presença do campo
// é rejeitada pelo service (deposito.service.atualizar), não pelo validator —
// a mensagem de negócio ("ainda não é suportado") é mais clara que um erro
// de formato genérico.
const atualizar = [
  body('nome').optional({ values: 'falsy' }).isString().trim().isLength({ min: 2, max: 100 })
    .withMessage('Nome deve ter entre 2 e 100 caracteres'),
  validar,
];

module.exports = { criar, atualizar };
