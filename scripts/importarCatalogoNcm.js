/**
 * Arquivo: importarCatalogoNcm.js
 * Responsabilidade: Popula CatalogoNcm com dados reais da API pública do
 * Portal Único Siscomex (RFB/MDIC) — endpoint oficial, sem autenticação,
 * confirmado ao vivo no PASSO 0 desta tarefa:
 *   https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json
 * Formato do JSON (confirmado por leitura direta): { Nomenclaturas: [
 *   { Codigo, Descricao, Data_Inicio, Data_Fim, Tipo_Ato_Ini, Numero_Ato_Ini,
 *     Ano_Ato_Ini, ... } ] } — só interessam os códigos de 8 dígitos (NCM
 * propriamente dito; a API também traz capítulos/posições/subposições de
 * 2 a 6 dígitos, que não são NCM válido pra uso em produto).
 * dataFimVigencia com valor "9999-12-31" na fonte = "sem previsão de fim"
 * — convertido para null aqui (mesmo significado de "vigente" que o resto
 * do sistema usa).
 * Upsert idempotente — pode rodar de novo (ex: quando a Receita atualizar
 * a tabela) sem duplicar; nunca faz DELETE (ver comentário no schema).
 * Uso: node scripts/importarCatalogoNcm.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const URL_NCM = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json';

/**
 * A API devolve datas em "DD/MM/AAAA" (confirmado por amostra real antes
 * de importar em massa) — new Date(string) interpretaria como MM/DD
 * (formato dos EUA) e inverteria dia/mês silenciosamente. "31/12/9999" é
 * o sentinela oficial de "sem previsão de fim" (não é uma data real).
 */
function dataOuNull(valor) {
  if (!valor) return null;
  const [dia, mes, ano] = valor.split('/');
  if (ano === '9999') return null;
  const d = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  return Number.isNaN(d.getTime()) ? null : d;
}

async function importar() {
  console.log('Baixando tabela NCM do Portal Único Siscomex...');
  const resp = await fetch(URL_NCM);
  if (!resp.ok) throw new Error(`Falha ao baixar NCM: HTTP ${resp.status}`);
  const dados = await resp.json();
  const nomenclaturas = dados.Nomenclaturas || dados.nomenclaturas || dados;
  if (!Array.isArray(nomenclaturas)) throw new Error('Formato inesperado da resposta da API Siscomex — verifique o payload antes de prosseguir.');

  // Códigos na fonte vêm formatados com pontos hierárquicos (ex:
  // "0101.21.00" = capítulo.posição.subposição.item) — confirmado por
  // amostra real antes de importar em massa. Removendo a pontuação, só o
  // NCM completo de 8 dígitos interessa (Produto.ncm exige exatamente
  // isso); capítulos/posições/subposições intermediários (2/4/6 dígitos)
  // não são NCM válido pra atribuir a um produto.
  const ncm8digitos = nomenclaturas
    .map((n) => ({ ...n, codigoLimpo: n.Codigo.replace(/\D/g, '') }))
    .filter((n) => n.codigoLimpo.length === 8);
  console.log(`Total de entradas na fonte: ${nomenclaturas.length} · NCM de 8 dígitos: ${ncm8digitos.length}`);

  const linhas = ncm8digitos.map((n) => ({
    codigo: n.codigoLimpo,
    descricao: n.Descricao,
    dataInicioVigencia: dataOuNull(n.Data_Inicio),
    dataFimVigencia: dataOuNull(n.Data_Fim),
    tipoAto: n.Tipo_Ato_Ini || null,
    numeroAto: n.Numero_Ato_Ini != null ? String(n.Numero_Ato_Ini) : null,
    anoAto: n.Ano_Ato_Ini != null ? String(n.Ano_Ato_Ini) : null,
  }));

  // ~10 mil linhas: upsert individual (1 round-trip por linha, banco
  // remoto) seria lento demais. Separa em "novo" (createMany em lote — 1-2
  // round-trips no total) e "já existe" (upsert individual só pra esses,
  // tipicamente poucas dezenas numa reimportação de atualização — ex: os
  // 24 códigos que a Receita mudou em fevereiro/2026, não a tabela toda).
  const existentes = new Set((await prisma.catalogoNcm.findMany({ select: { codigo: true } })).map((r) => r.codigo));
  const linhasNovas = linhas.filter((l) => !existentes.has(l.codigo));
  const linhasExistentes = linhas.filter((l) => existentes.has(l.codigo));

  const TAMANHO_LOTE = 1000;
  for (let i = 0; i < linhasNovas.length; i += TAMANHO_LOTE) {
    const lote = linhasNovas.slice(i, i + TAMANHO_LOTE);
    await prisma.catalogoNcm.createMany({ data: lote, skipDuplicates: true });
    console.log(`  ...${Math.min(i + TAMANHO_LOTE, linhasNovas.length)}/${linhasNovas.length} novos inseridos`);
  }

  let atualizados = 0;
  for (const l of linhasExistentes) {
    await prisma.catalogoNcm.update({ where: { codigo: l.codigo }, data: l });
    atualizados++;
  }

  console.log(`CatalogoNcm: ${linhasNovas.length} inseridos, ${atualizados} atualizados (total na fonte: ${linhas.length}).`);
}

importar()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
