/**
 * Arquivo: importarCatalogoClassTrib.js
 * Responsabilidade: Popula CatalogoCstIbsCbs e CatalogoClassTrib com dados
 * reais do Informe Técnico RT 2025.002 (Portal Nacional da NF-e) — fonte:
 * DOCS/cClassTrib 2026-06-22.xlsx, publicado em duas abas:
 *   - "CST 2026-06-01 Pub": Código Situação Tributária do IBS/CBS (TCST, 3
 *     dígitos) + descrição. Sem colunas de vigência nesta aba — fica
 *     dataInicioVigencia/dataFimVigencia nulas (não há data-fonte pra
 *     inventar).
 *   - "cClass 2026-06-01 Pub": Código de Classificação Tributária (6
 *     dígitos) + descrição completa + dispositivo legal (coluna "LC
 *     Redação") + vigência (dIniVig/dFimVig, serial Excel).
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

async function importarCstIbsCbs(wb) {
  const linhas = linhasDaAba(wb, 'CST 2026-06-01 Pub');
  let importados = 0;
  for (const linha of linhas) {
    const codigo = String(linha[0]);
    const descricao = String(linha[1]);
    await prisma.catalogoCstIbsCbs.upsert({
      where: { codigo },
      create: { codigo, descricao },
      update: { descricao },
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
    const dataInicioVigencia = dataDeSerialExcel(linha[21]); // coluna "dIniVig"
    const dataFimVigencia = dataDeSerialExcel(linha[22]); // coluna "dFimVig"
    await prisma.catalogoClassTrib.upsert({
      where: { codigo },
      create: { codigo, descricao, dispositivoLegal, versaoInforme: VERSAO_INFORME, dataInicioVigencia, dataFimVigencia },
      update: { descricao, dispositivoLegal, versaoInforme: VERSAO_INFORME, dataInicioVigencia, dataFimVigencia },
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
