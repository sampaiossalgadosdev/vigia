/**
 * Arquivo: tributoFiscal.service.js
 * Responsabilidade: Calcular IBS/CBS por item de venda (Reforma Tributária,
 * Fase 1b) conforme o regime tributário do tenant. Serviço puro — sem
 * Prisma, sem rede — os valores calculados aqui são gravados como
 * snapshot em VendaItem (valorIbs, valorCbs, cstIbsCbsAplicado,
 * cClassTribAplicado) no momento da venda pelo chamador; este service não
 * grava nada sozinho e nunca recalcula a partir do Produto atual depois.
 * Utilizado por: (Fase 1c) VendaService, no momento de registrar a venda.
 * Depende de: config/aliquotasFiscais.
 *
 * IMPORTANTE — o valor de IBS/CBS aqui é só DESTACADO no documento fiscal
 * como informação (compensado com PIS/Cofins em outra apuração, fora deste
 * sistema); ele NÃO é somado ao valor cobrado do cliente. Quem chama esta
 * função continua usando o preço/subtotal/total já praticado — não some
 * valorIbs/valorCbs a nada que o cliente paga.
 *
 * CST-IBS/CBS e cClassTrib: cstIbsCbsAplicado/cClassTribAplicado NÃO são
 * mais calculados aqui — são o código REAL que o produto já carrega
 * (Produto.cstIbsCbs/Produto.cClassTrib), escolhido pelo cadastrante num
 * autocomplete validado contra CatalogoCstIbsCbs/CatalogoClassTrib (dados
 * oficiais do Informe Técnico RT 2025.002, Portal Nacional da NF-e, fonte
 * DOCS/cClassTrib 2026-06-22.xlsx — ver scripts/importarCatalogoClassTrib.js
 * e produto.validator.js). Este service só REPASSA o que já foi validado no
 * cadastro; nunca inventa nem "arredonda" pra um código genérico. Produto
 * sem essa classificação preenchida (cadastro legado, anterior à obrigação
 * introduzida por produto.validator.js) faz esta função lançar — ver
 * ERRO_CLASSIFICACAO_AUSENTE abaixo — em vez de gravar um código fictício
 * num documento fiscal de verdade.
 *
 * ATENÇÃO — NÃO SOU CONTADOR: a leitura de que Simples Nacional está
 * dispensado da obrigação em 2026 (ver REGIMES_DISPENSADOS_2026, config/
 * aliquotasFiscais.js) é uma decisão contábil já sinalizada como pendente
 * de confirmação lá — não mexida aqui. Quando dispensado, cstIbsCbsAplicado/
 * cClassTribAplicado voltam null (não "não se aplica" fictício): o grupo
 * <IBSCBS> é omitido inteiro do XML nesse caso (nfceXml.service.js), então
 * nenhum CST/cClassTrib chega a ser transmitido — não há o que preencher.
 *
 * `classificacaoFiscal` (4º parâmetro, obrigatório quando o regime não é
 * dispensado): indicadores oficiais do par CST-IBS/CBS + cClassTrib do
 * produto (indGIbsCbs, indGRed, pRedIbs, pRedCbs), vindos do catálogo —
 * ver catalogoFiscal.repository.buscarClassificacaoFiscal. Este service
 * continua PURO (sem Prisma): quem chama (nfceEmissao.service.js, que já
 * acessa o banco) busca o indicador e passa aqui — decisão explícita pra
 * não duplicar o dado (que é 100% função do cClassTrib escolhido) em cima
 * do Produto, e pra que uma atualização futura do Informe Técnico (novo
 * percentual oficial) valha pra vendas novas sem precisar reeditar cada
 * produto cadastrado.
 * - indGIbsCbs=false (ex.: CST 410 — imunidade/não incidência): CST e
 *   cClassTrib são transmitidos, mas valorIbs/valorCbs saem zerados e o
 *   grupo de valor (gIBSCBS) é omitido inteiro no XML (NT 2025.002, regra
 *   UB12-10, "ind_gIBSCBS = 0").
 * - indGRed=true (ex.: CST 200 — alíquota reduzida): valorIbs/valorCbs já
 *   saem calculados NET da redução oficial (pRedIbs/pRedCbs, 0-100, do
 *   cClassTrib) — nfceXml.service.js usa esse valor líquido direto pra
 *   montar gIBSUF/gRed e gCBS/gRed (regras UB65-10/UB66-10: pAliqEfet =
 *   alíquota estatutária × (1 - pRedAliq/100); vIBSUF/vCBS = vBC ×
 *   pAliqEfet/100 — bate exatamente com o cálculo abaixo, já que vBC aqui
 *   é o próprio valorItem).
 */
const { AppError } = require('../utils/response');
const { ALIQUOTA_TESTE_2026, REGIMES_DISPENSADOS_2026 } = require('../config/aliquotasFiscais');

function arredondar(valor) {
  return Math.round(valor * 100) / 100;
}

/**
 * Calcula IBS/CBS de um item de venda e repassa a classificação fiscal
 * (CST-IBS/CBS + cClassTrib) já cadastrada no produto — nesta fase de
 * alíquota-teste única, só o VALOR depende do regime do tenant e da
 * redução oficial do cClassTrib; a CLASSIFICAÇÃO é sempre a do produto
 * (permite, por ex., um produto isento ao lado de um com tributação
 * integral na mesma venda).
 */
function calcularTributoItem(tenant, produto, valorItem, classificacaoFiscal) {
  if (REGIMES_DISPENSADOS_2026.includes(tenant.regimeTributario)) {
    return {
      valorIbs: 0,
      valorCbs: 0,
      cstIbsCbsAplicado: null,
      cClassTribAplicado: null,
      indGIbsCbs: null,
      indGRed: null,
      pRedIbsAplicado: null,
      pRedCbsAplicado: null,
    };
  }

  if (!produto.cstIbsCbs || !produto.cClassTrib) {
    throw new AppError(
      `Produto "${produto.nome}" sem classificação fiscal IBS/CBS (CST-IBS/CBS e/ou cClassTrib) — edite o cadastro do produto antes de emitir a NFC-e.`,
      422
    );
  }

  if (!classificacaoFiscal) {
    throw new AppError(
      `Indicadores fiscais (CST-IBS/CBS ${produto.cstIbsCbs} + cClassTrib ${produto.cClassTrib}) não encontrados no catálogo oficial — ver catalogoFiscal.repository.buscarClassificacaoFiscal (produto: ${produto.nome}).`,
      500
    );
  }

  if (classificacaoFiscal.indGIbsCbs === false) {
    return {
      valorIbs: 0,
      valorCbs: 0,
      cstIbsCbsAplicado: produto.cstIbsCbs,
      cClassTribAplicado: produto.cClassTrib,
      indGIbsCbs: false,
      indGRed: false,
      pRedIbsAplicado: null,
      pRedCbsAplicado: null,
    };
  }

  const aplicaReducao = classificacaoFiscal.indGRed === true;

  // Achado de revisão (2026-07-18): sem esta trava, pRedIbs/pRedCbs=null
  // (célula em branco no catálogo pra esse cClassTrib específico, mesmo
  // com o CST exigindo redução) faria `null / 100` virar 0 em JS —
  // fatorIbs saindo 1 (SEM redução) de forma silenciosa, na contramão da
  // regra que o resto deste arquivo já segue (nunca assume, sempre lança
  // quando o dado tá incompleto). Não é alcançável com o catálogo
  // importado hoje (todo cClassTrib com CST indGRed=true tem os dois
  // percentuais preenchidos) — é defesa contra uma atualização futura da
  // planilha oficial publicar um código incompleto.
  if (aplicaReducao && (classificacaoFiscal.pRedIbs === null || classificacaoFiscal.pRedCbs === null)) {
    throw new AppError(
      `CST-IBS/CBS ${produto.cstIbsCbs} exige redução de alíquota, mas o cClassTrib ${produto.cClassTrib} está sem o percentual de redução (pRedIBS/pRedCBS) preenchido no catálogo oficial — dado incompleto, não é possível calcular o tributo com segurança (produto: ${produto.nome}).`,
      500
    );
  }

  const pRedIbsAplicado = aplicaReducao ? classificacaoFiscal.pRedIbs : null;
  const pRedCbsAplicado = aplicaReducao ? classificacaoFiscal.pRedCbs : null;
  const fatorIbs = aplicaReducao ? 1 - pRedIbsAplicado / 100 : 1;
  const fatorCbs = aplicaReducao ? 1 - pRedCbsAplicado / 100 : 1;

  return {
    valorIbs: arredondar(valorItem * ALIQUOTA_TESTE_2026.IBS * fatorIbs),
    valorCbs: arredondar(valorItem * ALIQUOTA_TESTE_2026.CBS * fatorCbs),
    cstIbsCbsAplicado: produto.cstIbsCbs,
    cClassTribAplicado: produto.cClassTrib,
    indGIbsCbs: true,
    indGRed: aplicaReducao,
    pRedIbsAplicado,
    pRedCbsAplicado,
  };
}

module.exports = { calcularTributoItem };
