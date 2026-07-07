/**
 * Arquivo: planilha.js
 * Responsabilidade: Leitura pura de arquivos CSV e XLSX a partir de Buffer,
 * retornando linhas como objetos com cabeçalhos normalizados. Também gera
 * o modelo XLSX de importação de produtos.
 * Utilizado por: importacao.service.js
 */
const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');

const COLUNAS_MODELO = [
  'ean', 'nome', 'marca', 'ncm', 'unidade', 'preco', 'custo',
  'estoque_atual', 'estoque_minimo', 'categoria', 'plu', 'vendido_por_peso',
];

/**
 * Normaliza um cabeçalho: minúsculas, sem acentos, espaços viram underline.
 */
function normalizarCabecalho(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

/**
 * Detecta o formato pelo mimetype/extensão e retorna as linhas do arquivo
 * como array de objetos { cabecalho_normalizado: valor }.
 */
function lerPlanilha(buffer, mimetype = '', nomeArquivo = '') {
  const nome = nomeArquivo.toLowerCase();
  const ehCsv = mimetype.includes('csv') || nome.endsWith('.csv') || mimetype === 'text/plain';
  const ehXlsx =
    mimetype.includes('spreadsheet') || mimetype.includes('excel') ||
    nome.endsWith('.xlsx') || nome.endsWith('.xls');

  if (ehCsv) {
    const texto = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const delimitador = texto.split('\n')[0].includes(';') ? ';' : ',';
    const registros = parse(texto, {
      columns: (header) => header.map(normalizarCabecalho),
      delimiter: delimitador,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
    return registros;
  }

  if (ehXlsx) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const aba = wb.Sheets[wb.SheetNames[0]];
    const bruto = XLSX.utils.sheet_to_json(aba, { defval: '', raw: false });
    return bruto.map((linha) => {
      const normalizada = {};
      for (const chave of Object.keys(linha)) normalizada[normalizarCabecalho(chave)] = linha[chave];
      return normalizada;
    });
  }

  throw new Error('Formato de arquivo não suportado. Envie CSV ou XLSX.');
}

/**
 * Gera o Buffer do modelo.xlsx de importação com cabeçalhos e uma linha de exemplo.
 */
function gerarModeloXlsx() {
  const exemplo = {
    ean: '7891234567890', nome: 'Feijão Carioca 1kg', marca: 'Kicaldo', ncm: '07133399',
    unidade: 'UN', preco: '8.49', custo: '6.10', estoque_atual: '50', estoque_minimo: '10',
    categoria: 'Mercearia', plu: '', vendido_por_peso: 'nao',
  };
  const ws = XLSX.utils.json_to_sheet([exemplo], { header: COLUNAS_MODELO });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'produtos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { lerPlanilha, gerarModeloXlsx, COLUNAS_MODELO };
