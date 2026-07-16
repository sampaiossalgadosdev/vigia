/**
 * Arquivo: importarCatalogoCstCsosn.js
 * Responsabilidade: Popula CatalogoCst (ICMS, regime normal — CRT 2/3) e
 * CatalogoCsosn (Simples Nacional — CRT 1). Dados extraídos diretamente do
 * XSD oficial do layout NF-e 4.00, já empacotado localmente em
 * node_modules/@nfewizard/shared/resources/schemas/leiauteNFe_v4.00.xsd —
 * elementos <xs:element name="CST"> e <xs:element name="CSOSN">, cada um
 * com <xs:enumeration> (código) e <xs:documentation> (descrição oficial).
 * Só os blocos de CST do grupo ICMS foram usados (o mesmo nome "CST" no
 * XSD também aparece para PIS/COFINS/IPI — tributos distintos, sem campo
 * correspondente em Produto hoje, fora do escopo desta tabela).
 * Upsert idempotente — pode rodar de novo sem duplicar.
 * Uso: node scripts/importarCatalogoCstCsosn.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// CST do ICMS (regime normal) — código: descrição oficial (XSD, elemento CST
// dentro dos grupos ICMS00/ICMS10/ICMS20/.../ICMS90). Duplicatas do mesmo
// código em grupos derivados (ICMSPart, ICMSST) foram descartadas — mesmo
// código, mesma descrição, sem informação nova.
const CST_ICMS = {
  '00': 'Tributada integralmente',
  '02': 'Tributação monofásica própria sobre combustíveis',
  '10': 'Tributada e com cobrança do ICMS por substituição tributária',
  '15': 'Tributação monofásica própria e com responsabilidade pela retenção sobre combustíveis',
  '20': 'Com redução de base de cálculo',
  '30': 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária',
  '40': 'Isenta',
  '41': 'Não tributada',
  '50': 'Suspensão',
  '51': 'Diferimento',
  '53': 'Tributação monofásica sobre combustíveis com recolhimento diferido',
  '60': 'ICMS cobrado anteriormente por substituição tributária',
  '61': 'Tributação monofásica sobre combustíveis cobrada anteriormente',
  '70': 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária',
  '90': 'Outras',
};

// CSOSN (Simples Nacional) — código: descrição oficial (XSD, elementos
// ICMSSN101/102/201/202/500/900). Exatamente 10 códigos, confere com a
// tabela oficial do Simples Nacional.
const CSOSN = {
  '101': 'Tributada pelo Simples Nacional com permissão de crédito',
  '102': 'Tributada pelo Simples Nacional sem permissão de crédito',
  '103': 'Isenção do ICMS no Simples Nacional para faixa de receita bruta',
  '201': 'Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por Substituição Tributária',
  '202': 'Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por Substituição Tributária',
  '203': 'Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por Substituição Tributária',
  '300': 'Imune',
  '400': 'Não tributada pelo Simples Nacional',
  '500': 'ICMS cobrado anteriormente por substituição tributária (substituído) ou por antecipação',
  '900': 'Outros',
};

async function importar() {
  for (const [codigo, descricao] of Object.entries(CST_ICMS)) {
    await prisma.catalogoCst.upsert({
      where: { codigo },
      create: { codigo, descricao },
      update: { descricao },
    });
  }
  for (const [codigo, descricao] of Object.entries(CSOSN)) {
    await prisma.catalogoCsosn.upsert({
      where: { codigo },
      create: { codigo, descricao },
      update: { descricao },
    });
  }
  console.log(`CatalogoCst: ${Object.keys(CST_ICMS).length} códigos importados.`);
  console.log(`CatalogoCsosn: ${Object.keys(CSOSN).length} códigos importados.`);
}

importar()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
