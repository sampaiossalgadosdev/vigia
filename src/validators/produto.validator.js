/**
 * Arquivo: produto.validator.js
 * Responsabilidade: Schemas de validação de criação e edição de produto.
 * Utilizado por: produto.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');

const UNIDADES = ['UN', 'KG', 'CX', 'L', 'PC', 'FD'];

const regrasBase = (opcional = false) => {
  const req = (chain) => (opcional ? chain.optional({ values: 'falsy' }) : chain);
  return [
    req(body('ean'))
      .matches(/^\d{8}$|^\d{12,14}$/)
      .withMessage('EAN deve ter 8, 12, 13 ou 14 dígitos numéricos'),
    req(body('nome'))
      .isString().trim().isLength({ min: 2, max: 200 })
      .withMessage('Nome deve ter entre 2 e 200 caracteres'),
    req(body('preco'))
      .isFloat({ gt: 0, max: 999999.99 })
      .withMessage('Preço deve ser maior que zero e no máximo 999999.99'),
    body('ncm').optional({ values: 'falsy' }).matches(/^\d{8}$/).withMessage('NCM deve ter exatamente 8 dígitos'),
    body('unidade').optional({ values: 'falsy' }).isIn(UNIDADES).withMessage('Unidade deve ser UN, KG, CX, L, PC ou FD'),
    body('custoMedio').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('Custo médio deve ser >= 0'),
    body('estoqueQtd').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('Estoque inicial deve ser >= 0'),
    body('estoqueMin').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('Estoque mínimo deve ser >= 0'),
    body('categoriaId').optional({ values: 'falsy' }).isUUID().withMessage('categoriaId inválido'),
    body('vendidoPorPeso').optional().isBoolean().withMessage('vendidoPorPeso deve ser booleano'),
    body('plu')
      .if(body('vendidoPorPeso').equals('true'))
      .matches(/^\d{4,6}$/)
      .withMessage('PLU é obrigatório (4 a 6 dígitos) quando o produto é vendido por peso'),
    body('marca').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
  ];
};

const criar = [...regrasBase(false), validar];
const atualizar = [
  ...regrasBase(true),
  // Só editável na tela de edição — na criação o Cód. Ref. é gerado sozinho (ver produto.service.js).
  body('codigoReferencia').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }).withMessage('Cód. Ref. deve ter até 20 caracteres'),
  validar,
];

module.exports = { criar, atualizar, UNIDADES };
