/**
 * Arquivo: pdvSnapshot.service.js
 * Responsabilidade: Montar o snapshot completo (não incremental) que o PDV
 * baixa para popular seu SQLite local (Fase 3a — só leitura: catálogo,
 * preço e estoque/lote; nenhuma lógica de venda offline aqui, isso é 3b).
 * Assume Depósito Principal do tenant — o sistema ainda opera
 * single-depósito (venda, lote e estoque já resolvem tudo para o principal
 * hoje); não há hoje um conceito de "terminal vinculado a um depósito"
 * específico. Decisão de multi-loja/multi-depósito por terminal fica
 * pendente para uma fase futura — ver decisão registrada na investigação
 * da Fase 3a.
 * Bloco `fiscal` (novo): dados do tenant que o PDV precisa cachear pra
 * poder montar o XML da NFC-e em contingência sem depender do backend
 * estar no ar naquele momento (app ASSINATURA guarda o certificado; o PDV
 * guarda o resto). `crt`/`emiteIbsCbs`/`aliquotaIbs`/`aliquotaCbs` já vêm
 * PRÉ-CALCULADOS (mesmas tabelas de config/aliquotasFiscais.js e
 * sefaz.service.js que nfceXml.service.js/tributoFiscal.service.js usam)
 * — de propósito, pra essas regras de negócio (que MUDAM: a alíquota-teste
 * de 2026 é substituída em 2027) ficarem só aqui, e o PDV nunca precisar
 * duplicar/importar essas tabelas.
 * Nunca inclui certificado nem CSC — isso não sai do backend (ver select
 * explícito em pdvSnapshot.repository.buscarDadosFiscais).
 *
 * Campos fiscais por produto (cstIbsCbs/cClassTrib/indGIbsCbs/indGRed/
 * pRedIbs/pRedCbs — mesmos indicadores oficiais que nfceXml.service.js usa
 * pra montar gRed e decidir se omite o grupo IBSCBS, ver NT 2025.002-RTC):
 * esta função só PREPARA o dado, resolvendo os indicadores em lote contra
 * o catálogo oficial (catalogoFiscal.repository.listarIndicadoresCst/
 * listarIndicadoresClassTrib). O CONSUMO ainda não existe — o gerador de
 * XML de contingência do PDV (vigia-pdv/src/renderer/services/
 * nfceContingencia.js) continua com CST/cClassTrib fixos ('000'/'000001')
 * e sem gRed, e o schema SQLite local do PDV ainda não tem essas colunas.
 * Ficam PENDENTES (fora do escopo desta tarefa, que cobriu só o lado
 * backend): (1) adicionar as colunas no schema SQLite local (vigia-pdv),
 * (2) fazer o vendaContingencia.js/snapshotDb.js do PDV persistir esses
 * campos ao sincronizar, (3) reescrever nfceContingencia.js/
 * montarGrupoIbsCbs pra usar o mesmo cálculo de gRed/omissão que
 * nfceXml.service.js já usa no caminho online.
 * Utilizado por: rota GET /api/pdv/snapshot.
 */
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const pdvSnapshotRepo = require('../repositories/pdvSnapshot.repository');
const catalogoFiscalRepo = require('../repositories/catalogoFiscal.repository');
const prisma = require('../config/database');
const { CODIGO_UF } = require('./sefaz.service');
const { MAPA_CRT, REGIMES_DISPENSADOS_2026, ALIQUOTA_TESTE_2026 } = require('../config/aliquotasFiscais');

function montarFiscal(tenant) {
  return {
    cnpj: tenant.cnpj,
    nome: tenant.nome,
    uf: tenant.uf,
    cUF: CODIGO_UF[tenant.uf] || null,
    crt: MAPA_CRT[tenant.regimeTributario] ?? null,
    emiteIbsCbs: !REGIMES_DISPENSADOS_2026.includes(tenant.regimeTributario),
    aliquotaIbs: ALIQUOTA_TESTE_2026.IBS,
    aliquotaCbs: ALIQUOTA_TESTE_2026.CBS,
    ambienteFiscal: tenant.ambienteFiscal,
    inscricaoEstadual: tenant.inscricaoEstadual,
    logradouro: tenant.logradouro,
    numero: tenant.numero,
    complemento: tenant.complemento,
    bairro: tenant.bairro,
    municipio: tenant.municipio,
    codigoMunicipioIbge: tenant.codigoMunicipioIbge,
    cep: tenant.cep,
  };
}

async function montar(tenantId) {
  // Assume Depósito Principal do tenant — ver premissa documentada acima.
  const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenantId);

  const [produtos, estoques, tenantFiscal] = await Promise.all([
    pdvSnapshotRepo.listarProdutos(tenantId),
    pdvSnapshotRepo.listarEstoqueComLotes(deposito.id),
    pdvSnapshotRepo.buscarDadosFiscais(tenantId),
  ]);

  const estoquePorProduto = new Map(estoques.map((e) => [e.produtoId, e]));

  // Indicadores de CST-IBS/CBS e cClassTrib (ind_gIBSCBS/ind_gRed/pRedIBS/
  // pRedCBS, NT 2025.002-RTC — mesma fonte de tributoFiscal.service.js/
  // nfceXml.service.js) resolvidos EM LOTE (2 queries no catálogo global,
  // não uma por produto — CatalogoCstIbsCbs/CatalogoClassTrib têm só
  // 18/164 códigos ao todo, cabe montar o mapa uma vez e reaproveitar pra
  // cada produto do tenant). Só busca se o regime não for dispensado —
  // regime dispensado já teria emiteIbsCbs=false no bloco `fiscal` e o
  // consumidor do snapshot vai ignorar esses campos de qualquer jeito.
  const emiteIbsCbs = !REGIMES_DISPENSADOS_2026.includes(tenantFiscal.regimeTributario);
  const [indicadoresCst, indicadoresClassTrib] = emiteIbsCbs
    ? await Promise.all([catalogoFiscalRepo.listarIndicadoresCst(), catalogoFiscalRepo.listarIndicadoresClassTrib()])
    : [[], []];
  const mapaIndicadoresCst = new Map(indicadoresCst.map((c) => [c.codigo, c]));
  const mapaIndicadoresClassTrib = new Map(indicadoresClassTrib.map((c) => [c.codigo, c]));

  const produtosSnapshot = produtos.map((p) => {
    const estoque = estoquePorProduto.get(p.id);
    const cst = mapaIndicadoresCst.get(p.cstIbsCbs);
    const classTrib = mapaIndicadoresClassTrib.get(p.cClassTrib);
    return {
      id: p.id,
      nome: p.nome,
      ean: p.ean,
      plu: p.plu,
      codigoReferencia: p.codigoReferencia,
      unidade: p.unidade,
      ativo: p.ativo,
      precoVenda: Number(p.preco),
      controlaLote: p.controlaLote,
      permiteEstoqueNegativo: estoque ? estoque.permiteEstoqueNegativo : true,
      categoriaId: p.categoriaId,
      origemVersao: p.updatedAt.toISOString(),
      ncm: p.ncm,
      cfop: p.cfop,
      // CST-IBS/CBS e cClassTrib do produto (podem vir null — cadastro
      // legado sem classificação; ver produto.validator.js) + indicadores
      // JÁ RESOLVIDOS do catálogo oficial (null se o produto não tem
      // classificação, ou se o regime do tenant é dispensado em 2026).
      // Mesmo padrão do bloco `fiscal` abaixo: o PDV nunca calcula/decide
      // isso sozinho, só recebe pronto.
      cstIbsCbs: p.cstIbsCbs,
      cClassTrib: p.cClassTrib,
      indGIbsCbs: cst ? cst.indGIbsCbs : null,
      indGRed: cst ? cst.indGRed : null,
      pRedIbs: classTrib && classTrib.pRedIbs !== null ? Number(classTrib.pRedIbs) : null,
      pRedCbs: classTrib && classTrib.pRedCbs !== null ? Number(classTrib.pRedCbs) : null,
    };
  });

  const geradoEm = new Date().toISOString();

  const estoqueSnapshot = estoques.map((e) => ({
    produtoId: e.produtoId,
    depositoId: e.depositoId,
    quantidade: Number(e.quantidade),
    atualizadoEm: geradoEm,
  }));

  const lotes = estoques.flatMap((e) =>
    e.lotes.map((lote) => ({
      id: lote.id,
      produtoId: e.produtoId,
      depositoId: e.depositoId,
      quantidade: Number(lote.quantidade),
      dataValidade: lote.dataValidade.toISOString(),
      atualizadoEm: geradoEm,
    }))
  );

  return {
    geradoEm, depositoId: deposito.id, produtos: produtosSnapshot, estoque: estoqueSnapshot, lotes,
    fiscal: montarFiscal(tenantFiscal),
  };
}

module.exports = { montar };
