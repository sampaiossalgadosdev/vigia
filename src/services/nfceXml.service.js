/**
 * Arquivo: nfceXml.service.js
 * Responsabilidade: Montar o XML da NFC-e e a URL do QR Code (Reforma
 * Tributária, Fase 1b) — SEM assinar, SEM enviar à SEFAZ, SEM protocolo de
 * autorização (isso é a Fase 1c). Serviço puro: recebe a venda já
 * carregada (tenant, itens com produto, pagamentos) e só monta strings —
 * nenhum acesso a Prisma nem rede, 100% testável com teste unitário.
 * Utilizado por: (Fase 1c) fluxo de emissão, depois de calcular o tributo
 * com tributoFiscal.service.
 * Depende de: fast-xml-parser, utils/certcrypto, sefaz.service (CODIGO_UF),
 * config/aliquotasFiscais (MAPA_CRT), utils/response.
 *
 * ATENÇÃO — PLACEHOLDERS PENDENTES DE VALIDAÇÃO (ver comentários pontuais
 * abaixo, listados também no resumo da entrega):
 *   1. Estrutura do grupo IBSCBS (nomes/aninhamento dos campos)
 *   2. Versão do layout (infNFe/@versao) e do QR Code
 * (CRT, enderEmit, a chave de acesso, CST/cClassTrib e o rateio
 * estadual/municipal do IBS — ver montarGrupoIbsCbs — já usam dado
 * real/definitivo, não são mais placeholder.)
 */
const crypto = require('crypto');
const { XMLBuilder } = require('fast-xml-parser');
const { CODIGO_UF } = require('./sefaz.service');
const { MAPA_CRT, REGIMES_DISPENSADOS_2026, ALIQUOTA_TESTE_2026 } = require('../config/aliquotasFiscais');
const { descriptografarTexto } = require('../utils/certcrypto');
const { AppError } = require('../utils/response');

const MODELO_NFCE = '65';
// PLACEHOLDER — controle de série por tenant/loja ainda não existe; fica
// pra uma fase futura junto com o controle de numeração sequencial real.
// SEM zero à esquerda -- TSerie exige '0' ou '[1-9][0-9]{0,2}' (schema
// rejeitou '001' explicitamente; achado desta fase, não do prompt).
const SERIE_PADRAO = '1';
// PLACEHOLDER — versão do layout do Manual de Orientação do Contribuinte
// (QR Code); confirmar contra a versão vigente antes de produção.
const VERSAO_QRCODE = '2';

function arredondar2(valor) {
  return Number(valor || 0).toFixed(2);
}

function arredondar4(valor) {
  return Number(valor || 0).toFixed(4);
}

// Tabela padrão nacional de formas de pagamento da NFC-e (tPag) — convenção
// estável do layout NFe/NFC-e, não é algo que a Reforma Tributária altera.
// 'voucher' mapeado pra 99 (Outros) por falta de informação de qual tipo
// específico de vale (a tabela oficial distingue alimentação/refeição/
// presente/combustível, cada um com código próprio) — confirme contra o
// enum real de VendaPagamento.forma antes de produção.
const MAPA_FORMA_PAGAMENTO_TPAG = {
  dinheiro: '01',
  credito: '03',
  debito: '04',
  pix: '17',
  voucher: '99',
  outros: '99',
};

function mapearFormaPagamentoParaTPag(forma) {
  return MAPA_FORMA_PAGAMENTO_TPAG[forma] || '99';
}

/**
 * Formata data/hora no padrão exigido pelo schema (TDateTimeUTC: offset
 * explícito, não "Z"). Offset fixo em -03:00 (horário de Brasília, sem
 * horário de verão desde 2019) — mesma simplificação já assumida em
 * nfceEmissao.service.js (cancelamento): incorreta para tenants em UF com
 * fuso diferente (AC, oeste do AM), sem tratamento especial em nenhum
 * lugar do sistema hoje.
 */
function formatarDataHoraComOffset(data) {
  return new Date(data || Date.now()).toISOString().replace(/\.\d{3}Z$/, '-03:00');
}

/** Dígito verificador da chave de acesso: mod-11 com pesos 2..9 cíclicos da direita pra esquerda. */
function calcularDV(chave43) {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return String(resto < 2 ? 0 : 11 - resto);
}

/**
 * Monta a chave de acesso de 44 dígitos (cUF+AAMM+CNPJ+modelo+série+
 * número+tpEmis+cNF+DV), com o DV calculado de verdade. É a chave
 * DEFINITIVA a partir do momento em que é computada — não "vira real"
 * depois que a SEFAZ autoriza; a autorização decide se ESSE documento
 * (com essa chave) é aceito, não recalcula a chave. `numero` PRECISA vir
 * de um contador real (Tenant.ultimoNumeroNfce, reservado atomicamente —
 * ver nfceEmissao.service.reservarNumeroNfce/
 * reservarNumeroEChaveNfceNaTransacao); esta função nunca gera um sozinha.
 */
function montarChaveAcessoPlaceholder(tenant, { numero, cNF, dataEmissao, tpEmis = '1' } = {}) {
  const cUF = CODIGO_UF[tenant.uf];
  if (!cUF) throw new AppError('UF do tenant inválida ou não configurada — necessária para montar a chave de acesso', 422);
  if (!numero) throw new AppError('numero não foi reservado antes de montar a chave de acesso — ver nfceEmissao.service.reservarNumeroNfce', 500);

  const cnpj = String(tenant.cnpj).padStart(14, '0');
  const agora = dataEmissao ? new Date(dataEmissao) : new Date();
  const aamm = String(agora.getFullYear()).slice(2) + String(agora.getMonth() + 1).padStart(2, '0');
  const numeroStr = String(numero).padStart(9, '0');
  const cNFStr = String(cNF !== undefined ? cNF : Math.floor(Math.random() * 99999999)).padStart(8, '0');

  // A chave de acesso reserva 3 posições FIXAS pra série, sempre — mesmo
  // que o elemento <serie> do XML não use zero à esquerda (TSerie do
  // schema rejeita '001', só aceita '1'). São duas representações
  // diferentes do mesmo valor: aqui é sempre zero-padded a 3 dígitos,
  // porque a chave é posicional (largura fixa de 44), não um campo com
  // pattern próprio.
  const serieChave = String(SERIE_PADRAO).padStart(3, '0');
  const chave43 = cUF + aamm + cnpj + MODELO_NFCE + serieChave + numeroStr + tpEmis + cNFStr;
  return chave43 + calcularDV(chave43);
}

// Art. 343, LC 214/2025 (texto literal): "Em relação aos fatos geradores
// ocorridos de 1º de janeiro a 31 de dezembro de 2026, o IBS será cobrado
// mediante aplicação da alíquota estadual de 0,1%" — o parágrafo único
// ainda tira essa arrecadação das repartições constitucionais normais
// (vai pro Comitê Gestor/Fundo de Compensação, não pra município). Ou
// seja: em 2026 o IBS-teste é, por LEI, 100% estadual — 0% em gIBSMun não
// é aproximação, é o valor certo por enquanto.
// Isso MUDA em 01/01/2027: Art. 344, LC 214/2025 (texto literal) — "o IBS
// será cobrado à alíquota estadual de 0,05% e à alíquota municipal de
// 0,05%" pra fatos geradores de 2027 e 2028. O rateio 50/50 (e a mudança
// de ALIQUOTA_TESTE_2026 pra uma versão datada) ainda não foi
// implementado — decisão de quando/como fazer isso não é deste service
// sozinho (ver conversa que confirmou os artigos acima em 2026-07-17).
// VIGENCIA_RATEIO_ESTADUAL_FIM é o gatilho: depois dessa data, lança em
// vez de continuar emitindo 100/0 silenciosamente errado.
// NÃO SOU ADVOGADO/CONTADOR — os dois artigos foram confirmados por
// pesquisa em fontes externas (bases jurídicas que citam o texto literal
// da LC 214/2025), não direto no Diário Oficial/Planalto (indisponível no
// momento da pesquisa); recomendo checagem por contador antes de produção.
const VIGENCIA_RATEIO_ESTADUAL_FIM = new Date('2027-01-01T00:00:00-03:00');

// Alíquotas-teste estatutárias (Art. 343/346, LC 214/2025) — SEMPRE o
// valor cheio nas tags pIBSUF/pCBS, mesmo quando há redução (NT 2025.002,
// regra UB56-10: "Alíquota da CBS (tag: pCBS) deve ser igual a 0,9%..." —
// a mesma regra vale pro lado IBS, ver UB26 da NT). É o efeito da redução
// (gRed/pAliqEfet) que reflete o percentual líquido, nunca pIBSUF/pCBS.
const P_IBS_UF_ESTATUTARIO = arredondar2(ALIQUOTA_TESTE_2026.IBS * 100);
const P_CBS_ESTATUTARIO = arredondar2(ALIQUOTA_TESTE_2026.CBS * 100);

/**
 * Grupo de tributos IBS/CBS por item (Det.Imposto.IBSCBS), estrutura
 * CONFIRMADA contra o XSD real bundled em @nfewizard/shared
 * (DFeTiposBasicos_v1.00.xsd, tipo TCIBS) e contra a NT 2025.002-RTC v1.50
 * (regras UB12-10, UB64-10/UB64-20, UB65-10/UB66-10 — pesquisa de
 * 2026-07-18, PDF oficial baixado de nfe.fazenda.gov.br).
 * CST e cClassTrib vêm de item.cstIbsCbsAplicado/item.cClassTribAplicado —
 * o código REAL que o produto carrega desde o cadastro (Produto.cstIbsCbs/
 * Produto.cClassTrib), validado contra o catálogo oficial (Informe Técnico
 * RT 2025.002 — ver tributoFiscal.service.js). Só chega aqui já garantido
 * pelo chamador (nfceEmissao.service.itensComTributo, via
 * tributoFiscal.service.calcularTributoItem, que lança se o produto não
 * tiver essa classificação) — o `if` abaixo é só uma segunda trava (nunca
 * deixa um documento fiscal sair com CST/cClassTrib vazio por engano de
 * quem chamar esta função por outro caminho).
 * `item.indGIbsCbs`/`item.indGRed`/`item.pRedIbsAplicado`/
 * `item.pRedCbsAplicado` vêm do mesmo cálculo (tributoFiscal.service.js,
 * que por sua vez recebe o indicador oficial do catálogo via
 * catalogoFiscal.repository.buscarClassificacaoFiscal — ver comentário lá).
 * indGIbsCbs=false (ex.: CST 410 — imunidade/não incidência): retorna só
 * CST/cClassTrib, sem o grupo gIBSCBS inteiro (não há base a destacar).
 * `dataEmissao`: data real do fato gerador (venda.criadoEm, mesma usada em
 * dhEmi/chave de acesso) — usada só pra decidir o rateio gIBSUF/gIBSMun
 * (ver VIGENCIA_RATEIO_ESTADUAL_FIM acima).
 */
function montarGrupoIbsCbs(item, valorItemBase, dataEmissao) {
  if (!item.cstIbsCbsAplicado || !item.cClassTribAplicado)
    throw new AppError(`Item sem CST-IBS/CBS ou cClassTrib aplicado — ver tributoFiscal.service.calcularTributoItem (produto: ${item.produto?.nome || item.produto?.id || 'desconhecido'})`, 500);
  if (dataEmissao >= VIGENCIA_RATEIO_ESTADUAL_FIM)
    throw new AppError('Rateio de IBS entre estado e município desatualizado: a partir de 01/01/2027 (Art. 344, LC 214/2025) o IBS deixa de ser 100% estadual (passa a 0,05% estadual + 0,05% municipal) — implemente o rateio novo antes de emitir NFC-e com data de emissão em 2027 ou depois.', 500);

  const base = { CST: item.cstIbsCbsAplicado, cClassTrib: item.cClassTribAplicado };

  // CST com ind_gIBSCBS=0 (ex.: 410 — imunidade/não incidência): a NT
  // 2025.002 proíbe informar o grupo gIBSCBS nesse caso (regra em torno de
  // UB12-10/UB68 — "Grupo IBS/CBS informado indevidamente").
  if (item.indGIbsCbs === false) return base;

  const gIBSUF = item.indGRed
    ? {
        pIBSUF: P_IBS_UF_ESTATUTARIO,
        gRed: {
          pRedAliq: arredondar2(item.pRedIbsAplicado),
          pAliqEfet: arredondar4(ALIQUOTA_TESTE_2026.IBS * 100 * (1 - item.pRedIbsAplicado / 100)),
        },
        vIBSUF: arredondar2(item.valorIbs),
      }
    : { pIBSUF: P_IBS_UF_ESTATUTARIO, vIBSUF: arredondar2(item.valorIbs) };

  const gCBS = item.indGRed
    ? {
        pCBS: P_CBS_ESTATUTARIO,
        gRed: {
          pRedAliq: arredondar2(item.pRedCbsAplicado),
          pAliqEfet: arredondar4(ALIQUOTA_TESTE_2026.CBS * 100 * (1 - item.pRedCbsAplicado / 100)),
        },
        vCBS: arredondar2(item.valorCbs),
      }
    : { pCBS: P_CBS_ESTATUTARIO, vCBS: arredondar2(item.valorCbs) };

  return {
    ...base,
    gIBSCBS: {
      vBC: arredondar2(valorItemBase),
      gIBSUF,
      gIBSMun: { pIBSMun: '0.00', vIBSMun: '0.00' },
      vIBS: arredondar2(item.valorIbs),
      gCBS,
    },
  };
}

/**
 * Gera o XML da NFC-e — monta e valida estruturalmente, NÃO assina nem
 * envia (Fase 1b). `venda` precisa vir com tenant, itens (com produto) e
 * pagamentos já carregados — este service não acessa Prisma.
 * `opcoes.tpEmis` (Fase 1c): '1' = emissão normal (padrão); outro valor
 * quando a nota sai em contingência (ex: '7' = SVC-RS) — precisa refletir
 * no XML porque o layout de contingência usa uma tag tpEmis diferente.
 * Retorna { xml, chaveAcesso }.
 */
function gerarXmlNfce(venda, { tpEmis = '1' } = {}) {
  const tenant = venda.tenant;
  // numeroNfce PRECISA vir já reservado por quem chama (nfceEmissao.
  // service.reservarNumeroNfce, que incrementa Tenant.ultimoNumeroNfce
  // atomicamente) — gerarXmlNfce é uma função pura, sem acesso a Prisma,
  // então não pode reservar sozinha. Lançar aqui em vez de cair num
  // placeholder aleatório evita que um bug na reserva passe despercebido
  // como "funcionou", só com número não-sequencial.
  if (!venda.numeroNfce) throw new AppError('numeroNfce não foi reservado antes de montar o XML — ver nfceEmissao.service.reservarNumeroNfce', 500);
  const numero = venda.numeroNfce; // TNF exige >=1, sem zero à esquerda — garantido pela reserva (começa em 1)

  // Venda pode já ter uma chave de acesso REAL, reservada de forma
  // SÍNCRONA no momento da venda (venda.service.registrar, quando a
  // config fiscal está completa) — pra o DANFE poder ser impresso na hora,
  // sem esperar o worker assíncrono (filaEmissaoNfce) processar. Quando
  // isso já existe, REAPROVEITA exatamente, sem recalcular: cNF é
  // sorteado uma vez só (dentro da reserva síncrona, ou aqui, nunca nos
  // dois lugares) -- recalcular aqui geraria um cNF DIFERENTE e a chave
  // transmitida à SEFAZ divergiria da chave já impressa e entregue ao
  // cliente no cupom.
  const chaveJaReservada = venda.chaveNfce && /^\d{44}$/.test(venda.chaveNfce);
  // TODO(dataVenda): quando a chave AINDA não existe (caminho abaixo),
  // usa venda.criadoEm (momento do INSERT), não venda.dataVenda (momento
  // real da venda) — numa venda offline sincronizada tarde, a chave de
  // acesso nasceria com a data errada. A urgência da fila de emissão
  // (filaEmissaoNfce.service) já foi corrigida pra usar dataVenda; isto
  // aqui ficou de fora por decisão explícita (fora de escopo da tarefa
  // que introduziu dataVenda) e continua pendente.
  const chaveAcesso = chaveJaReservada
    ? venda.chaveNfce
    : montarChaveAcessoPlaceholder(tenant, { numero, cNF: Math.floor(Math.random() * 99999999), dataEmissao: venda.criadoEm, tpEmis });
  // cDV é o último dígito da própria chave de acesso (já calculado ali) --
  // reaproveitado, não recalculado, pra nunca poder divergir.
  const cDV = chaveAcesso.slice(-1);
  // cNF (posições 35-43 da chave, 0-indexed) é SEMPRE extraído da própria
  // chaveAcesso final, nunca guardado numa variável à parte -- garante que
  // <ide><cNF> bate exatamente com o que está embutido na chave, não
  // importa por qual dos dois caminhos acima ela veio.
  const cNF = chaveAcesso.slice(35, 43);

  // Simples Nacional (dispensado em 2026, ver config/aliquotasFiscais.js):
  // o elemento <IBSCBS> é opcional no schema (minOccurs="0") -- decisão
  // desta fase é OMITI-LO inteiro pra esses tenants, em vez de forçar um
  // CST/cClassTrib placeholder fictício num regime onde IBS/CBS
  // simplesmente não se aplica ainda.
  const emiteIbsCbs = !REGIMES_DISPENSADOS_2026.includes(tenant.regimeTributario);

  const det = venda.itens.map((item, i) => ({
    '@_nItem': String(i + 1),
    prod: {
      cProd: item.produto.codigoReferencia || item.produto.id,
      cEAN: item.produto.ean || 'SEM GTIN',
      xProd: item.produto.nome,
      NCM: item.produto.ncm || '',
      CFOP: item.produto.cfop || '',
      uCom: item.produto.unidade || 'UN',
      qCom: String(item.quantidade),
      vUnCom: arredondar2(item.precoUnitario),
      vProd: arredondar2(item.total),
      cEANTrib: item.produto.ean || 'SEM GTIN',
      uTrib: item.produto.unidade || 'UN',
      qTrib: String(item.quantidade),
      vUnTrib: arredondar2(item.precoUnitario),
      indTot: '1', // 1 = valor do item compõe o valor total da NFC-e
    },
    imposto: emiteIbsCbs ? { IBSCBS: montarGrupoIbsCbs(item, item.total, new Date(venda.criadoEm)) } : {},
  }));

  const xmlObj = {
    NFe: {
      infNFe: {
        '@_versao': '4.00', // PLACEHOLDER — confirmar versão do schema pós-reforma
        ide: {
          cUF: CODIGO_UF[tenant.uf],
          cNF: String(cNF).padStart(8, '0'),
          natOp: 'VENDA',
          mod: MODELO_NFCE,
          serie: SERIE_PADRAO,
          nNF: String(numero),
          // TODO(dataVenda): mesma pendência do dataEmissao acima — dhEmi
          // deveria refletir venda.dataVenda (momento real da venda) numa
          // sincronização tardia, não venda.criadoEm (momento do INSERT).
          dhEmi: formatarDataHoraComOffset(venda.criadoEm),
          tpNF: '1', // 1 = Saída
          idDest: '1', // 1 = Operação interna
          cMunFG: tenant.codigoMunicipioIbge || '',
          tpImp: '4', // 4 = DANFE NFC-e
          tpEmis, // '1' normal; outro valor em contingência (ex: '7' = SVC-RS)
          cDV,
          tpAmb: tenant.ambienteFiscal === 'producao' ? '1' : '2',
          finNFe: '1', // 1 = NFe normal
          indFinal: '1', // 1 = consumidor final
          indPres: '1', // 1 = operação presencial
          procEmi: '0', // 0 = emissão com aplicativo do contribuinte
          verProc: '1.0.0', // versão do aplicativo emissor (VIGIA)
        },
        emit: {
          CNPJ: tenant.cnpj,
          xNome: tenant.nome,
          enderEmit: {
            xLgr: tenant.logradouro || '',
            nro: tenant.numero || '',
            ...(tenant.complemento ? { xCpl: tenant.complemento } : {}),
            xBairro: tenant.bairro || '',
            cMun: tenant.codigoMunicipioIbge || '',
            xMun: tenant.municipio || '',
            UF: tenant.uf || '',
            CEP: String(tenant.cep || '').replace(/\D/g, ''),
            cPais: '1058', // Brasil
            xPais: 'Brasil',
          },
          IE: tenant.inscricaoEstadual || '',
          CRT: String(MAPA_CRT[tenant.regimeTributario] ?? ''),
        },
        det,
        total: {
          // Sequência COMPLETA exigida pelo schema (TICMSTot) — venda de
          // balcão sem ICMS próprio (regime é tratado via IBS/CBS,
          // ver imposto/IBSCBS por item), frete/seguro/IPI/PIS/COFINS
          // zerados por não se aplicarem a NFC-e de varejo comum; os
          // únicos valores reais são vProd/vDesc/vNF (já praticados hoje).
          ICMSTot: {
            vBC: '0.00', vICMS: '0.00', vICMSDeson: '0.00', vFCP: '0.00',
            vBCST: '0.00', vST: '0.00', vFCPST: '0.00', vFCPSTRet: '0.00',
            vProd: arredondar2(venda.subtotal),
            vFrete: '0.00', vSeg: '0.00',
            vDesc: arredondar2(venda.desconto || 0),
            vII: '0.00', vIPI: '0.00', vIPIDevol: '0.00',
            vPIS: '0.00', vCOFINS: '0.00', vOutro: '0.00',
            // Valor cobrado do cliente — IGUAL ao já praticado hoje; IBS/CBS
            // é só destacado por item (imposto/IBSCBS), nunca somado aqui.
            vNF: arredondar2(venda.total),
          },
        },
        // NFC-e de balcão: sem transportador. modFrete=9 ("Sem transporte")
        // é o único campo exigido pelo schema neste grupo pra esse caso.
        transp: { modFrete: '9' },
        pag: {
          detPag: (venda.pagamentos || []).map((p) => ({ tPag: mapearFormaPagamentoParaTPag(p.forma), vPag: arredondar2(p.valor) })),
        },
      },
    },
  };

  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(xmlObj);
  return { xml, chaveAcesso };
}

/**
 * Monta a URL do QR Code da NFC-e a partir do CSC do tenant (conforme
 * tenant.ambienteFiscal — homologação ou produção). Fórmula do hash:
 * SHA-1(chaveAcesso + tpAmb + idCSC + CSC) — mecanismo do QR-Code em si
 * não muda com a Reforma (depende do CSC, não do grupo IBS/CBS); ainda
 * assim, confira contra o Manual de Orientação do Contribuinte vigente
 * antes de produção. Isso NÃO é mock — é a mesma lógica de produção; só
 * não depende de nenhuma chamada à SEFAZ.
 * `urlConsulta` varia por UF/ambiente — a tabela real fica pra Fase 1c;
 * aqui é só um parâmetro (com um placeholder de exemplo por padrão).
 */
function montarUrlQrCode(tenant, chaveAcesso, urlConsulta = 'https://SUBSTITUIR-URL-CONSULTA-POR-UF') {
  const producao = tenant.ambienteFiscal === 'producao';
  const cscCriptografado = producao ? tenant.cscProducao : tenant.cscHomologacao;
  const idCsc = producao ? tenant.cscProducaoId : tenant.cscHomologacaoId;
  if (!cscCriptografado)
    throw new AppError(`CSC de ${producao ? 'produção' : 'homologação'} não configurado para este tenant`, 422);

  const csc = descriptografarTexto(cscCriptografado);
  const tpAmb = producao ? '1' : '2';
  const hash = crypto.createHash('sha1').update(chaveAcesso + tpAmb + idCsc + csc).digest('hex');
  return `${urlConsulta}?p=${chaveAcesso}|${VERSAO_QRCODE}|${tpAmb}|${idCsc}|${hash}`;
}

module.exports = { gerarXmlNfce, montarUrlQrCode, montarChaveAcessoPlaceholder };
