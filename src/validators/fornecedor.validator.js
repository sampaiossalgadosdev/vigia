/**
 * Arquivo: fornecedor.validator.js
 * Responsabilidade: Schemas de validação de criação e edição de fornecedor.
 * O documento é validado conforme o tipo: CNPJ para pessoa jurídica, CPF
 * para pessoa física (ex: produtor rural) — sempre com dígito verificador.
 * Utilizado por: fornecedor.routes.js.
 */
const { body } = require('express-validator');
const { validar } = require('./auth.validator');
const { validarCnpj, validarCpf } = require('../utils/cnpj');

const REGIMES = ['simples', 'presumido', 'real'];
const TIPOS = ['pessoa_juridica', 'pessoa_fisica'];
const ICMS = ['contribuinte', 'nao_contribuinte'];

function documentoValido(valor, { req }) {
  if (req.body.tipo === 'pessoa_fisica') return validarCpf(valor);
  if (req.body.tipo === 'pessoa_juridica') return validarCnpj(valor);
  // tipo não informado (ex: edição parcial): aceita qualquer um dos dois
  return validarCnpj(valor) || validarCpf(valor);
}

const texto = (campo, max = 120) =>
  body(campo).optional({ values: 'falsy' }).isString().trim().isLength({ max });

const regras = (opcional = false) => {
  const req = (chain) => (opcional ? chain.optional({ values: 'falsy' }) : chain);
  return [
    req(body('nome')).isString().trim().isLength({ min: 2, max: 200 }).withMessage('Nome é obrigatório (2 a 200 caracteres)'),
    req(body('cnpj')).custom(documentoValido).withMessage('Documento inválido: confira o CNPJ (14 dígitos) ou CPF (11 dígitos)'),
    body('tipo').optional({ values: 'falsy' }).isIn(TIPOS).withMessage('Tipo deve ser pessoa_juridica ou pessoa_fisica'),
    body('email').optional({ values: 'falsy' }).isEmail().withMessage('E-mail inválido'),
    texto('telefone', 20),
    texto('celular', 20),
    texto('observacao', 1000),
    body('contribuinteIcms').optional({ values: 'falsy' }).isIn(ICMS).withMessage('Contribuinte ICMS inválido'),
    body('regimeTributario').optional({ values: 'falsy' }).isIn(REGIMES).withMessage('Regime tributário inválido'),
    texto('cep', 9),
    texto('logradouro', 200),
    texto('numero', 20),
    texto('complemento', 100),
    texto('bairro', 100),
    texto('cidade', 100),
    body('uf').optional({ values: 'falsy' }).isString().trim().isLength({ min: 2, max: 2 }).withMessage('UF deve ter 2 letras'),
    texto('finCategoria'),
    texto('finTipoDocumento'),
    texto('finConta'),
    texto('finCentroCusto'),
    body('representantes').optional().isArray().withMessage('Representantes deve ser uma lista'),
    body('representantes.*.nome').optional({ values: 'falsy' }).isString().trim().isLength({ max: 200 }),
    body('representantes.*.email').optional({ values: 'falsy' }).isEmail().withMessage('E-mail de representante inválido'),
    body('representantes.*.telefone').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }),
    body('representantes.*.celular').optional({ values: 'falsy' }).isString().trim().isLength({ max: 20 }),
  ];
};

const criar = [...regras(false), validar];
const atualizar = [...regras(true), validar];

const consultarCnpj = [
  body('cnpj').custom((v) => validarCnpj(v)).withMessage('CNPJ inválido: confira os 14 dígitos'),
  validar,
];

module.exports = { criar, atualizar, consultarCnpj };
