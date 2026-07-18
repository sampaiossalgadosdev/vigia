/**
 * Arquivo: importarCatalogoClassTrib.js
 * Responsabilidade: Popula CatalogoCstIbsCbs e CatalogoClassTrib com dados
 * reais do Informe Técnico RT 2025.002 (Portal Nacional da NF-e) — fonte:
 * DOCS/cClassTrib 2026-06-22.xlsx, publicado em duas abas:
 *   - "CST 2026-06-01 Pub": Código Situação Tributária do IBS/CBS (TCST, 3
 *     dígitos) + descrição + indicadores ind_gIBSCBS (col. 2) e ind_gRed
 *     (col. 4), usados por nfceXml.service.js pra decidir se o grupo de
 *     valor é omitido (CST 410 — imunidade) e se o subgrupo gRed é exigido
 *     (CST 200 — alíquota reduzida). Sem colunas de vigência nesta aba —
 *     fica dataInicioVigencia/dataFimVigencia nulas (não há data-fonte pra
 *     inventar).
 *   - "cClass 2026-06-01 Pub": Código de Classificação Tributária (6
 *     dígitos) + descrição completa + dispositivo legal (coluna "LC
 *     Redação") + vigência (dIniVig/dFimVig, serial Excel) + percentuais
 *     oficiais de redução pRedIBS (col. 10) e pRedCBS (col. 11).
 * Índices de coluna conferidos manualmente contra o cabeçalho real da
 * planilha (2026-07-18) — a aba não muda de estrutura entre publicações do
 * mesmo Informe Técnico, mas confirme os índices se um novo arquivo-fonte
 * for usado no futuro.
 * Upsert idempotente — pode rodar de novo sem duplicar.
 * Uso: node scripts/importarCatalogoClassTrib.js
 */
const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CAMINHO_XLSX = path.join(__dirname, '..', 'DOCS', 'cClassTrib 2026-06-22.xlsx');
const VERSAO_INFORME = 'RT 2025.002';

/** Serial de data do Excel (base 1899-12-30) → Date real. */
function dataDeSerialExcel(serial) {
  if (serial === '' || serial === undefined || serial === null) return null;
  const ms = Math.round((Number(serial) - 25569) * 86400 * 1000);
  return new Date(ms);
}

function linhasDaAba(wb, nomeAba) {
  const sheet = wb.Sheets[nomeAba];
  const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const [, ...dados] = linhas;
  return dados.filter((l) => l[0] !== '' && l[0] !== undefined);
}

/** Célula 0/1 da planilha → Boolean, ou null se a célula vier vazia. */
function paraBooleano(valor) {
  if (valor === '' || valor === undefined || valor === null) return null;
  return Number(valor) === 1;
}

/** Célula percentual (0-100) da planilha → Number, ou null se vazia. */
function paraPercentual(valor) {
  if (valor === '' || valor === undefined || valor === null) return null;
  return Number(valor);
}

async function importarCstIbsCbs(wb) {
  const linhas = linhasDaAba(wb, 'CST 2026-06-01 Pub');
  let importados = 0;
  for (const linha of linhas) {
    const codigo = String(linha[0]);
    const descricao = String(linha[1]);
    const indGIbsCbs = paraBooleano(linha[2]); // coluna "ind_gIBSCBS"
    const indGRed = paraBooleano(linha[4]); // coluna "ind_gRed"
    await prisma.catalogoCstIbsCbs.upsert({
      where: { codigo },
      create: { codigo, descricao, indGIbsCbs, indGRed },
      update: { descricao, indGIbsCbs, indGRed },
    });
    importados++;
  }
  console.log(`CatalogoCstIbsCbs: ${importados} códigos importados (fonte: ${linhas.length} linhas na aba).`);
}

async function importarClassTrib(wb) {
  const linhas = linhasDaAba(wb, 'cClass 2026-06-01 Pub');
  let importados = 0;
  for (const linha of linhas) {
    const codigo = String(linha[2]); // coluna "cClassTrib"
    const descricao = String(linha[4]); // coluna "Descrição cClassTrib"
    const dispositivoLegal = linha[5] ? String(linha[5]) : null; // coluna "LC Redação"
    const pRedIbs = paraPercentual(linha[10]); // coluna "pRedIBS"
    const pRedCbs = paraPercentual(linha[11]); // coluna "pRedCBS"
    const dataInicioVigencia = dataDeSerialExcel(linha[21]); // coluna "dIniVig"
    const dataFimVigencia = dataDeSerialExcel(linha[22]); // coluna "dFimVig"
    await prisma.catalogoClassTrib.upsert({
      where: { codigo },
      create: { codigo, descricao, dispositivoLegal, versaoInforme: VERSAO_INFORME, pRedIbs, pRedCbs, dataInicioVigencia, dataFimVigencia },
      update: { descricao, dispositivoLegal, versaoInforme: VERSAO_INFORME, pRedIbs, pRedCbs, dataInicioVigencia, dataFimVigencia },
    });
    importados++;
  }
  console.log(`CatalogoClassTrib: ${importados} códigos importados (fonte: ${linhas.length} linhas na aba).`);
}

async function importar() {
  const wb = XLSX.readFile(CAMINHO_XLSX);
  await importarCstIbsCbs(wb);
  await importarClassTrib(wb);
}

importar()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
