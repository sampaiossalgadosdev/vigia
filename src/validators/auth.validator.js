/**
 * Arquivo: auth.validator.js
 * Responsabilidade: Schemas de validação das rotas de autenticação.
 * Utilizado por: auth.routes.js, superadmin.routes.js, rede.routes.js.
 */
const { body, validationResult } = require('express-validator');
const { error } = require('../utils/response');

const validar = (req, res, next) => {
  const resultado = validationResult(req);
  if (!resultado.isEmpty())
    return error(res, 'Dados inválidos', resultado.array().map((e) => e.msg), 422);
  next();
};

const login = [
  body('email').isEmail().withMessage('E-mail inválido'),
  body('senha').isString().notEmpty().withMessage('Senha é obrigatória'),
  validar,
];

const refresh = [
  body('refreshToken').isString().notEmpty().withMessage('refreshToken é obrigatório'),
  validar,
];

module.exports = { login, refresh, validar };
