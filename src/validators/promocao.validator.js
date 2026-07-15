/**
 * Arquivo: promocao.validator.js
 * Responsabilidade: Schemas de validação de criação e edição de promoção.
 * Sem isso, um body malformado (produtoId inexistente, leveQtd/pagueQtd como
 * string em vez de número) batia direto no Prisma e virava 500 genérico —
 * incidente real em produção (POST /api/promocoes, tela Promoções).
 * Utilizado por: promocao.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');

const TIPOS = ['percentual', 'valor_fixo', 'leve_pague'];

const regrasBase = (opcional = false) => {
  const req = (chain) => (opcional ? chain.optional({ values: 'falsy' }) : chain);
  return [
    req(body('produtoId')).isUUID().withMessage('Selecione um produto válido'),
    req(body('nome')).isString().trim().isLength({ min: 1, max: 200 }).withMessage('Nome é obrigatório'),
    req(body('tipo')).isIn(TIPOS).withMessage('Tipo deve ser percentual, valor_fixo ou leve_pague'),
    // .toFloat()/.toInt() sanitizam de verdade (mutam req.body) — só validar
    // com isFloat/isInt não basta: uma string numérica válida ("1") passaria
    // na validação e ainda assim chegaria como string no Prisma, que rejeita
    // string num campo Int/Decimal (foi exatamente o bug em produção).
    req(body('desconto')).isFloat({ min: 0 }).withMessage('Desconto deve ser um número maior ou igual a zero').toFloat(),
    req(body('dataInicio')).isISO8601().withMessage('Data início inválida'),
    req(body('dataFim')).isISO8601().withMessage('Data fim inválida'),
    body('leveQtd').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('Leve qtd deve ser um número inteiro maior que zero').toInt(),
    body('pagueQtd').optional({ values: 'null' }).isInt({ min: 1 }).withMessage('Pague qtd deve ser um número inteiro maior que zero').toInt(),
  ];
};

const criar = [...regrasBase(false), validar];
const atualizar = [...regrasBase(true), validar];

module.exports = { criar, atualizar, TIPOS };
