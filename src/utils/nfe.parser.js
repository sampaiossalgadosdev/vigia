/**
 * Arquivo: nfe.parser.js
 * Responsabilidade: Parse puro de XML de NF-e (modelo 55) extraindo cabeçalho,
 * emitente e itens em formato normalizado para o EstoqueService.
 * Utilizado por: estoque.service.js
 * Não acessa banco nem HTTP.
 */
const { XMLParser } = require('fast-xml-parser');

/**
 * Garante que um nó seja tratado como array (fast-xml-parser retorna
 * objeto único quando há apenas um elemento).
 */
function comoArray(valor) {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

/**
 * Verifica se o campo cEAN traz um GTIN utilizável (8/12/13/14 dígitos).
 */
function eanValido(valor) {
  const ean = String(valor || '').trim();
  return /^\d{8}$|^\d{12,14}$/.test(ean) ? ean : null;
}

/**
 * Faz o parse do XML da NF-e e retorna { chaveAcesso, numeroNfe, dataEmissao,
 * valorTotal, emitente: { cnpj, nome, email?, telefone? }, itens: [...] }.
 * Lança Error com mensagem legível se o XML não for uma NF-e válida.
 */
function parseNfe(xmlString) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let doc;
  try {
    doc = parser.parse(xmlString);
  } catch (e) {
    throw new Error('Arquivo XML malformado');
  }

  const nfe = doc?.nfeProc?.NFe || doc?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new Error('XML não é uma NF-e válida (infNFe não encontrado)');

  const chaveAcesso = String(inf['@_Id'] || '').replace(/^NFe/i, '');
  if (!/^\d{44}$/.test(chaveAcesso)) throw new Error('Chave de acesso da NF-e inválida');

  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const total = inf.total?.ICMSTot || {};

  const itens = comoArray(inf.det).map((det, indice) => {
    const prod = det.prod || {};
    return {
      numeroItem: Number(det['@_nItem'] || indice + 1),
      ean: eanValido(prod.cEAN) || eanValido(prod.cEANTrib),
      codigoFornecedor: String(prod.cProd || ''),
      descricao: String(prod.xProd || 'Item sem descrição'),
      ncm: prod.NCM ? String(prod.NCM) : null,
      unidade: String(prod.uCom || 'UN').toUpperCase(),
      quantidade: Number(prod.qCom || 0),
      valorUnitario: Number(prod.vUnCom || 0),
      valorTotal: Number(prod.vProd || 0),
    };
  });

  if (itens.length === 0) throw new Error('NF-e não possui itens');

  return {
    chaveAcesso,
    numeroNfe: String(ide.nNF || ''),
    dataEmissao: new Date(ide.dhEmi || ide.dEmi || Date.now()),
    valorTotal: Number(total.vNF || itens.reduce((acc, i) => acc + i.valorTotal, 0)),
    emitente: {
      cnpj: String(emit.CNPJ || '').replace(/\D/g, ''),
      nome: String(emit.xNome || 'Fornecedor da NF-e'),
      telefone: emit.enderEmit?.fone ? String(emit.enderEmit.fone) : null,
    },
    itens,
  };
}

module.exports = { parseNfe };
