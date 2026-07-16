/**
 * Arquivo: produto.validator.js
 * Responsabilidade: Schemas de validação de criação e edição de produto.
 * Utilizado por: produto.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');
const catalogoFiscalRepo = require('../repositories/catalogoFiscal.repository');

const UNIDADES = ['UN', 'KG', 'CX', 'L', 'PC', 'FD'];

/**
 * Validador de existência num catálogo fiscal de referência (NCM, CFOP,
 * CST-IBS/CBS, cClassTrib) — sem isso, o campo só validava FORMATO (8
 * dígitos, 4 dígitos etc.), nunca se o código existe de verdade. `existeFn`
 * é uma das funções existe* de catalogoFiscal.repository.
 */
function existeNoCatalogo(existeFn, rotulo) {
  return async (valor) => {
    if (!(await existeFn(valor))) throw new Error(`${rotulo} não encontrado no catálogo de referência (ou não está mais vigente)`);
    return true;
  };
}

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
    // NCM/CFOP/CST-IBS-CBS/cClassTrib são obrigatórios (criação E edição) —
    // decisão de produto: cadastro de produto é feito por gerente/funcionário
    // sem pressão de tempo, não pelo caixa na venda. Efeito colateral aceito:
    // editar um produto antigo sem esses dados (ainda sem migração do
    // catálogo do sistema anterior) exige completar os 4 campos primeiro.
    body('ncm').notEmpty().withMessage('NCM é obrigatório').bail()
      .matches(/^\d{8}$/).withMessage('NCM deve ter exatamente 8 dígitos')
      .bail().custom(existeNoCatalogo(catalogoFiscalRepo.existeNcm, 'NCM')),
    body('unidade').optional({ values: 'falsy' }).isIn(UNIDADES).withMessage('Unidade deve ser UN, KG, CX, L, PC ou FD'),
    body('custoMedio').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('Custo médio deve ser >= 0'),
    body('estoqueQtd').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('Estoque inicial deve ser >= 0'),
    body('estoqueMin').optional({ values: 'null' }).isFloat({ min: 0 }).withMessage('Estoque mínimo deve ser >= 0'),
    body('categoriaId').optional({ values: 'falsy' }).isUUID().withMessage('categoriaId inválido'),
    body('vendidoPorPeso').optional().isBoolean().withMessage('vendidoPorPeso deve ser booleano'),
    body('permiteEstoqueNegativo').optional().isBoolean().withMessage('permiteEstoqueNegativo deve ser booleano'),
    body('controlaLote').optional().isBoolean().withMessage('controlaLote deve ser booleano'),
    body('plu')
      .if(body('vendidoPorPeso').equals('true'))
      .matches(/^\d{4,6}$/)
      .withMessage('PLU é obrigatório (4 a 6 dígitos) quando o produto é vendido por peso'),
    body('marca').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }),
    body('precoDesejado').optional({ values: 'falsy' }).isFloat({ gt: 0, max: 999999.99 }).withMessage('Preço desejado deve ser maior que zero e no máximo 999999.99'),
    body('cfop').notEmpty().withMessage('CFOP é obrigatório').bail()
      .matches(/^\d{4}$/).withMessage('CFOP deve ter exatamente 4 dígitos')
      .bail().custom(existeNoCatalogo(catalogoFiscalRepo.existeCfop, 'CFOP')),
    body('origem').optional({ values: 'falsy' }).isIn(['nacional', 'importado']).withMessage('Origem deve ser nacional ou importado'),
    body('configTributaria').optional({ values: 'falsy' })
      .isIn(['tributado_integral', 'substituicao_tributaria', 'isento', 'nao_tributado'])
      .withMessage('Configuração tributária inválida'),
    // Campos da Reforma Tributária (IBS/CBS) — consumidos de fato hoje em
    // nfceXml.service.js (cstIbsCbsAplicado/cClassTribAplicado). Formato
    // confirmado contra o XSD oficial (TCST: 3 dígitos, TcClassTrib: 6
    // dígitos); existência contra os catálogos de referência.
    body('cstIbsCbs').notEmpty().withMessage('CST-IBS/CBS é obrigatório').bail()
      .matches(/^\d{3}$/).withMessage('CST-IBS/CBS deve ter exatamente 3 dígitos')
      .bail().custom(existeNoCatalogo(catalogoFiscalRepo.existeCstIbsCbs, 'CST-IBS/CBS')),
    body('cClassTrib').notEmpty().withMessage('cClassTrib é obrigatório').bail()
      .matches(/^\d{6}$/).withMessage('cClassTrib deve ter exatamente 6 dígitos')
      .bail().custom(existeNoCatalogo(catalogoFiscalRepo.existeClassTrib, 'cClassTrib')),
  ];
};

const criar = [...regrasBase(false), validar];
const atualizar = [
  ...regrasBase(true),
  // Só editável na tela de edição — na criação o Cód. Ref. é gerado sozinho (ver produto.service.js).
  body('codigoReferencia').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }).withMessage('Cód. Ref. deve ter até 20 caracteres'),
  validar,
];

// Alteração em lote: só Grupo, Unidade e Marca são editáveis assim
// (Nome, EAN e Cód. Ref. nunca — o service ignora qualquer outro campo).
const CAMPOS_LOTE = ['categoriaId', 'unidade', 'marca'];
const emLote = [
  body('produtoIds').isArray({ min: 1 }).withMessage('Informe ao menos um produto'),
  body('produtoIds.*').isUUID().withMessage('produtoIds contém um id inválido'),
  body('alteracoes')
    .custom((v) => v && typeof v === 'object' && !Array.isArray(v) && CAMPOS_LOTE.some((c) => v[c] !== undefined && v[c] !== '' && v[c] !== null))
    .withMessage('Informe ao menos um campo em alteracoes (categoriaId, unidade ou marca)'),
  body('alteracoes.categoriaId').optional({ values: 'falsy' }).isUUID().withMessage('categoriaId inválido'),
  body('alteracoes.unidade').optional({ values: 'falsy' }).isIn(UNIDADES).withMessage('Unidade deve ser UN, KG, CX, L, PC ou FD'),
  body('alteracoes.marca').optional({ values: 'falsy' }).isString().trim().isLength({ min: 1, max: 100 }).withMessage('Marca deve ter até 100 caracteres'),
  validar,
];

module.exports = { criar, atualizar, emLote, CAMPOS_LOTE, UNIDADES };
