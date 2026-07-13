/**
 * Arquivo: venda.validator.js
 * Responsabilidade: Schema de validação do registro de venda (PDV) — garante
 * que a venda tenha ao menos um item, quantidades positivas e desconto não
 * negativo antes de chegar ao service. `POST /sync` (lote vindo do PDV) não
 * usa este validator; venda.service.registrar valida os mesmos limites por
 * conta própria para cobrir esse caminho também.
 * Utilizado por: venda.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');

const registrar = [
  body('itens').isArray({ min: 1 }).withMessage('A venda precisa ter ao menos um item'),
  body('itens.*.produtoId').isUUID().withMessage('produtoId inválido'),
  body('itens.*.quantidade').isFloat({ gt: 0 }).withMessage('Quantidade deve ser maior que zero'),
  body('desconto').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('Desconto não pode ser negativo'),
  validar,
];

module.exports = { registrar };
