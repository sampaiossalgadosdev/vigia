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
 *   2. Rateio de IBS entre gIBSUF (estadual) e gIBSMun (municipal)
 *   3. Chave de acesso (formato correto, mas sem validade fiscal real)
 *   4. Versão do layout (infNFe/@versao) e do QR Code
 * (CRT e enderEmit já usam dado real do Tenant — resolvidos nesta fase.)
 */
const crypto = require('crypto');
const { XMLBuilder } = require('fast-xml-parser');
const { CODIGO_UF } = require('./sefaz.service');
const { MAPA_CRT, REGIMES_DISPENSADOS_2026 } = require('../config/aliquotasFiscais');
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
 * PLACEHOLDER ESTRUTURAL — monta uma chave de acesso no formato correto de
 * 44 dígitos (cUF+AAMM+CNPJ+modelo+série+número+tpEmis+cNF+DV), com o DV
 * calculado de verdade. SEM VALIDADE FISCAL REAL: a chave oficial só passa
 * a existir depois que a SEFAZ autoriza o documento (Fase 1c). Aqui, número
 * sequencial e código numérico (cNF) não vêm de nenhum controle real ainda.
 */
function montarChaveAcessoPlaceholder(tenant, { numero, cNF, dataEmissao, tpEmis = '1' } = {}) {
  const cUF = CODIGO_UF[tenant.uf];
  if (!cUF) throw new AppError('UF do tenant inválida ou não configurada — necessária para montar a chave de acesso', 422);

  const cnpj = String(tenant.cnpj).padStart(14, '0');
  const agora = dataEmissao ? new Date(dataEmissao) : new Date();
  const aamm = String(agora.getFullYear()).slice(2) + String(agora.getMonth() + 1).padStart(2, '0');
  const numeroStr = String(numero || Math.floor(Math.random() * 999999999)).padStart(9, '0');
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

// PLACEHOLDER NUMÉRICO — o schema XSD só exige o FORMATO (CST: \d{3};
// cClassTrib: \d{6}), não valida se o código é real. cstIbsCbsAplicado/
// cClassTribAplicado (tributoFiscal.service.js) continuam sendo os
// marcadores de texto (PENDENTE_...) usados internamente/no banco; isto
// aqui é só a tradução pro formato que o XML exige. NÃO são códigos
// tributários válidos — confirme contra a tabela oficial do Comitê Gestor
// do IBS/CBS antes de produção (mesma pendência já sinalizada em
// tributoFiscal.service.js, agora também aqui).
const CST_IBSCBS_PLACEHOLDER_NUMERICO = '000';
const CCLASSTRIB_PLACEHOLDER_NUMERICO = '000001';

/**
 * PLACEHOLDER — grupo de tributos IBS/CBS por item (Det.Imposto.IBSCBS),
 * estrutura CONFIRMADA contra o XSD real bundled em @nfewizard/shared
 * (DFeTiposBasicos_v1.00.xsd, tipo TCIBS) — substitui a estrutura anterior,
 * que era uma pesquisa não verificada contra schema real.
 * O rateio entre gIBSUF (estadual) e gIBSMun (municipal) aqui joga 100% do
 * IBS (valor E alíquota) em gIBSUF e 0% em gIBSMun — o rateio real depende
 * de tabela do Comitê Gestor do IBS por UF/Município e PRECISA ser
 * confirmado antes de produção. CST e cClassTrib "reais" (tributoFiscal.
 * service, também placeholders) viram códigos numéricos aqui só pra bater
 * com o formato do schema (ver constantes acima) — não representam
 * validação contra a tabela oficial.
 */
function montarGrupoIbsCbs(item, valorItemBase) {
  const aliquotaIbsPercentual = arredondar2((item.valorIbs / valorItemBase) * 100);
  const aliquotaCbsPercentual = arredondar2((item.valorCbs / valorItemBase) * 100);
  return {
    CST: CST_IBSCBS_PLACEHOLDER_NUMERICO,
    cClassTrib: CCLASSTRIB_PLACEHOLDER_NUMERICO,
    gIBSCBS: {
      vBC: arredondar2(valorItemBase),
      gIBSUF: { pIBSUF: aliquotaIbsPercentual, vIBSUF: arredondar2(item.valorIbs) },
      gIBSMun: { pIBSMun: '0.00', vIBSMun: '0.00' },
      vIBS: arredondar2(item.valorIbs),
      gCBS: { pCBS: aliquotaCbsPercentual, vCBS: arredondar2(item.valorCbs) },
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
  // cNF e número gerados AQUI (uma vez só) e reaproveitados tanto na chave
  // de acesso quanto no <ide> do XML -- se cada um usasse sua própria
  // geração independente, a chave gravada em Venda.chaveNfce poderia
  // divergir da chave que a lib recalcula a partir do XML na Fase 1c
  // (mesmos dígitos, mas por coincidência, não por garantia).
  const cNF = Math.floor(Math.random() * 99999999);
  const numero = venda.numeroNfce || Math.floor(Math.random() * 999999999) + 1; // TNF exige >=1, sem zero à esquerda
  const chaveAcesso = montarChaveAcessoPlaceholder(tenant, {
    numero, cNF, dataEmissao: venda.criadoEm, tpEmis,
  });
  // cDV é o último dígito da própria chave de acesso (já calculado ali) --
  // reaproveitado, não recalculado, pra nunca poder divergir.
  const cDV = chaveAcesso.slice(-1);

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
    imposto: emiteIbsCbs ? { IBSCBS: montarGrupoIbsCbs(item, item.total) } : {},
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
