/**
 * Arquivo: contaReceber.validator.js
 * Responsabilidade: Schema de validação de criação de ContaReceber.
 * Utilizado por: contaReceber.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');

const criar = [
  body('descricao').isString().trim().isLength({ min: 3, max: 255 }).withMessage('Descrição deve ter entre 3 e 255 caracteres'),
  body('valor').isFloat({ gt: 0 }).withMessage('Valor deve ser maior que zero'),
  body('dataVencimento').isISO8601().withMessage('Data de vencimento inválida'),
  body('vendaId').optional({ values: 'falsy' }).isUUID().withMessage('vendaId inválido'),
  body('observacao').optional({ values: 'falsy' }).isString().trim().isLength({ max: 500 }),
  validar,
];

const baixa = [
  body('dataRecebimento').optional({ values: 'falsy' }).isISO8601().withMessage('Data de recebimento inválida'),
  body('formaRecebimento').optional({ values: 'falsy' }).isString().trim().isLength({ max: 50 }),
  validar,
];

const cancelar = [
  body('motivo').isString().trim().isLength({ min: 5 }).withMessage('Motivo é obrigatório (mínimo 5 caracteres)'),
  validar,
];

module.exports = { criar, baixa, cancelar };
