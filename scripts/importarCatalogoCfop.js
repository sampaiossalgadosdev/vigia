/**
 * Arquivo: importarCatalogoCfop.js
 * Responsabilidade: Popula CatalogoCfop com dados reais de duas fontes
 * oficiais, combinadas por código:
 *   - Descrição: Ajuste SINIEF Nº 3/2024 (CONFAZ), texto legal completo —
 *     DOCS/AJUSTE SINIEF 03_24 — Conselho Nacional de Política Fazendária
 *     CONFAZ CFOP.pdf. Só os códigos FOLHA são importados (ex: "1.101 -
 *     Compra para..."), não os cabeçalhos de grupo (ex: "1.100 - COMPRAS
 *     PARA...", identificados pelo texto "Classificam-se neste grupo" em
 *     vez de "Classificam-se neste código" que segue todo código folha).
 *   - Vigência: Informe Técnico IT 2023.002 v1.00 (Tabela CFOP Vigência),
 *     DOCS/IT 2023.002-v1.00_Tabela_CFOP_Vigência_20230424.xlsx — datas em
 *     serial Excel, convertidas para Date.
 * tipoOperacao derivado do primeiro dígito do código (convenção estável do
 * layout, não earlier específica desta fonte): 1-3 = entrada, 5-7 = saída.
 * Upsert idempotente — pode rodar de novo sem duplicar.
 * Uso: node scripts/importarCatalogoCfop.js
 */
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CAMINHO_PDF = path.join(__dirname, '..', 'DOCS', 'AJUSTE SINIEF 03_24 — Conselho Nacional de Política Fazendária CONFAZ CFOP.pdf');
const CAMINHO_XLSX = path.join(__dirname, '..', 'DOCS', 'IT 2023.002-v1.00_Tabela_CFOP_Vigência_20230424.xlsx');

/** Serial de data do Excel (base 1899-12-30) → Date real. */
function dataDeSerialExcel(serial) {
  if (serial === '' || serial === undefined || serial === null) return null;
  const ms = Math.round((Number(serial) - 25569) * 86400 * 1000);
  return new Date(ms);
}

async function extrairDescricoesDoPdf() {
  const buf = fs.readFileSync(CAMINHO_PDF);
  const parser = new PDFParse({ data: buf });
  const { text } = await parser.getText();
  await parser.destroy();

  // Só o corpo do Anexo II (entre "ANEXO II" e a cláusula segunda) — a
  // "RETIFICAÇÃO" no fim do documento repete trechos (onde se lê/leia-se)
  // que duplicariam códigos se não fossem excluídos.
  const inicio = text.indexOf('ANEXO II');
  const fim = text.indexOf('Cláusula segunda');
  let corpo = text.slice(inicio, fim > inicio ? fim : undefined);

  // Remove o cabeçalho/rodapé repetido em toda quebra de página (timestamp
  // de impressão + título + URL + número de página + marcador "-- N of 63
  // --" do pdf-parse) — sem isso, um título de código que quebra entre
  // páginas (ex: 5.102) fica com esse lixo colado no meio da descrição.
  // Substitui por quebra de linha (não espaço) — precisa preservar o
  // limite de linha pra âncora ^ do próximo código continuar reconhecendo
  // onde uma nova linha começa (um espaço aqui grudaria o fim de uma frase
  // direto no início da próxima, quebrando a ancoragem por linha abaixo).
  corpo = corpo.replace(
    /\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}\s*\tAJUSTE SINIEF 03\/24 — Conselho Nacional de Política Fazendária CONFAZ\s*\nhttps:\/\/www\.confaz\.fazenda\.gov\.br\/legislacao\/ajustes\/2024\/AJ003_24\s*\t\d+\/63\s*\n\n-- \d+ of 63 --\s*\n/g,
    '\n'
  );

  // Âncora de INÍCIO DE LINHA (^ com multiline): só bate com o cabeçalho
  // real do código, nunca com uma referência cruzada entre-aspas dentro do
  // parágrafo de outro código (ex: 1.116 cita "1.922 -..." no meio da
  // frase — isso nunca começa uma linha na extração do PDF, então o
  // ancoramento em ^ não confunde as duas coisas). Cada bloco vai do
  // início de um código até o início do próximo (ou fim do texto).
  const marcador = /^(\d)\.(\d{3}) - /gm;
  const posicoes = [...corpo.matchAll(marcador)].map((m) => ({ codigo: m[1] + '.' + m[2], inicio: m.index, inicioTexto: m.index + m[0].length }));

  const descricoes = new Map(); // codigo → descrição (primeira ocorrência)
  for (let i = 0; i < posicoes.length; i++) {
    const { codigo, inicioTexto } = posicoes[i];
    const fimBloco = i + 1 < posicoes.length ? posicoes[i + 1].inicio : corpo.length;
    const bloco = corpo.slice(inicioTexto, fimBloco);

    const marcaClassificacao = bloco.search(/Classificam-se neste (código|grupo)/);
    if (marcaClassificacao === -1) continue; // não deveria acontecer; pula defensivamente
    const ehGrupo = /Classificam-se neste grupo/.test(bloco.slice(marcaClassificacao, marcaClassificacao + 30));
    if (ehGrupo) continue; // cabeçalho de grupo, não é CFOP de verdade

    if (descricoes.has(codigo)) continue; // mantém a primeira descrição (algumas se repetem em blocos de exceção/retificação)
    const descricao = bloco.slice(0, marcaClassificacao).replace(/\s+/g, ' ').trim().replace(/\.$/, '');
    descricoes.set(codigo, descricao);
  }
  return descricoes;
}

function extrairVigenciaDoXlsx() {
  const wb = XLSX.readFile(CAMINHO_XLSX);
  const sheet = wb.Sheets['CFOP'];
  const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const [cabecalho, ...dados] = linhas;
  const vigencia = new Map(); // codigo → { dataInicioVigencia, dataFimVigencia }
  for (const linha of dados) {
    const codigoNum = linha[0];
    if (!codigoNum) continue;
    const codigo = String(codigoNum).replace(/^(\d)(\d{3})$/, '$1.$2');
    vigencia.set(codigo, {
      dataInicioVigencia: dataDeSerialExcel(linha[1]),
      dataFimVigencia: dataDeSerialExcel(linha[2]),
    });
  }
  return vigencia;
}

async function importar() {
  const descricoes = await extrairDescricoesDoPdf();
  const vigencias = extrairVigenciaDoXlsx();

  console.log(`Descrições extraídas do PDF: ${descricoes.size}`);
  console.log(`Códigos com vigência no Excel: ${vigencias.size}`);

  let importados = 0;
  let semDescricao = [];
  for (const [codigoComPonto, { dataInicioVigencia, dataFimVigencia }] of vigencias) {
    const descricao = descricoes.get(codigoComPonto);
    if (!descricao) { semDescricao.push(codigoComPonto); continue; }
    // Ponto separador (formato do texto legal/Excel, "5.102") só serve pra
    // casar as duas fontes entre si — Produto.cfop (e o próprio validator
    // já existente) usa 4 dígitos sem pontuação ("5102"), mesmo formato
    // que vai pro elemento <CFOP> do XML em nfceXml.service.js.
    const codigo = codigoComPonto.replace('.', '');
    const tipoOperacao = /^[123]/.test(codigo) ? 'entrada' : 'saida';
    await prisma.catalogoCfop.upsert({
      where: { codigo },
      create: { codigo, descricao, tipoOperacao, dataInicioVigencia, dataFimVigencia },
      update: { descricao, tipoOperacao, dataInicioVigencia, dataFimVigencia },
    });
    importados++;
  }

  console.log(`CatalogoCfop: ${importados} códigos importados.`);
  if (semDescricao.length) console.log(`Códigos com vigência no Excel mas SEM descrição encontrada no PDF (não importados): ${semDescricao.join(', ')}`);

  const noPdfNaoNoExcel = [...descricoes.keys()].filter((c) => !vigencias.has(c));
  if (noPdfNaoNoExcel.length) console.log(`Códigos com descrição no PDF mas sem vigência no Excel (não importados, ficam pendentes): ${noPdfNaoNoExcel.join(', ')}`);
}

importar()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
