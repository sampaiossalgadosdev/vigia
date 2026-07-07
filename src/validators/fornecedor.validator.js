/**
 * Arquivo: fornecedor.validator.js
 * Responsabilidade: Schemas de validação de criação e edição de fornecedor,
 * incluindo validação de formato e dígito verificador do CNPJ.
 * Utilizado por: fornecedor.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');
const { validarCnpj } = require('../utils/cnpj');

const regras = (opcional = false) => {
  const req = (chain) => (opcional ? chain.optional({ values: 'falsy' }) : chain);
  return [
    req(body('nome')).isString().trim().isLength({ min: 2, max: 200 }).withMessage('Nome é obrigatório (2 a 200 caracteres)'),
    req(body('cnpj')).custom((v) => validarCnpj(v)).withMessage('CNPJ inválido'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('E-mail inválido'),
    body('telefone').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }),
  ];
};

const criar = [...regras(false), validar];
const atualizar = [...regras(true), validar];

module.exports = { criar, atualizar };
