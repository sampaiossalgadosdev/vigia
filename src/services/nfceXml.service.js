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
const { MAPA_CRT } = require('../config/aliquotasFiscais');
const { descriptografarTexto } = require('../utils/certcrypto');
const { AppError } = require('../utils/response');

const MODELO_NFCE = '65';
// PLACEHOLDER — controle de série por tenant/loja ainda não existe; fica
// pra Fase 1c junto com o controle de numeração sequencial real.
const SERIE_PADRAO = '001';
// PLACEHOLDER — versão do layout do Manual de Orientação do Contribuinte
// (QR Code); confirmar contra a versão vigente antes de produção.
const VERSAO_QRCODE = '2';

function arredondar2(valor) {
  return Number(valor || 0).toFixed(2);
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

  const chave43 = cUF + aamm + cnpj + MODELO_NFCE + SERIE_PADRAO + numeroStr + tpEmis + cNFStr;
  return chave43 + calcularDV(chave43);
}

/**
 * PLACEHOLDER — grupo de tributos IBS/CBS por item (Det.Imposto.IBSCBS),
 * estrutura conforme pesquisa da NT 2025.002 (Reforma Tributária):
 *   IBSCBS > CST, cClassTrib, gIBSCBS > vBC, gIBSUF, gIBSMun, gCBS, vIBS
 * O rateio entre gIBSUF (estadual) e gIBSMun (municipal) aqui joga 100% do
 * IBS em gIBSUF e 0% em gIBSMun — o rateio real depende de tabela do
 * Comitê Gestor do IBS por UF/Município e PRECISA ser confirmado antes de
 * produção. CST e cClassTrib vêm prontos de tributoFiscal.service (também
 * placeholders, ver aquele arquivo).
 */
function montarGrupoIbsCbs(item, valorItemBase) {
  return {
    CST: item.cstIbsCbsAplicado,
    cClassTrib: item.cClassTribAplicado,
    gIBSCBS: {
      vBC: arredondar2(valorItemBase),
      gIBSUF: { vIBSUF: arredondar2(item.valorIbs) },
      gIBSMun: { vIBSMun: '0.00' },
      gCBS: { vCBS: arredondar2(item.valorCbs) },
      vIBS: arredondar2(item.valorIbs),
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
  const chaveAcesso = montarChaveAcessoPlaceholder(tenant, {
    numero: venda.numeroNfce, dataEmissao: venda.criadoEm, tpEmis,
  });

  const det = venda.itens.map((item, i) => ({
    '@_nItem': String(i + 1),
    prod: {
      cProd: item.produto.codigoReferencia || item.produto.id,
      xProd: item.produto.nome,
      NCM: item.produto.ncm || '',
      CFOP: item.produto.cfop || '',
      uCom: item.produto.unidade || 'UN',
      qCom: String(item.quantidade),
      vUnCom: arredondar2(item.precoUnitario),
      vProd: arredondar2(item.total),
    },
    imposto: {
      IBSCBS: montarGrupoIbsCbs(item, item.total),
    },
  }));

  const xmlObj = {
    NFe: {
      infNFe: {
        '@_versao': '4.00', // PLACEHOLDER — confirmar versão do schema pós-reforma
        ide: {
          cUF: CODIGO_UF[tenant.uf],
          mod: MODELO_NFCE,
          serie: SERIE_PADRAO,
          tpAmb: tenant.ambienteFiscal === 'producao' ? '1' : '2',
          tpEmis, // '1' normal; outro valor em contingência (ex: '7' = SVC-RS)
          dhEmi: new Date(venda.criadoEm || Date.now()).toISOString(),
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
            CEP: tenant.cep || '',
            cPais: '1058', // Brasil
            xPais: 'Brasil',
          },
          IE: tenant.inscricaoEstadual || '',
          CRT: String(MAPA_CRT[tenant.regimeTributario] ?? ''),
        },
        det,
        total: {
          ICMSTot: {
            vProd: arredondar2(venda.subtotal),
            vDesc: arredondar2(venda.desconto || 0),
            // Valor cobrado do cliente — IGUAL ao já praticado hoje; IBS/CBS
            // é só destacado por item (imposto/IBSCBS), nunca somado aqui.
            vNF: arredondar2(venda.total),
          },
        },
        pag: {
          detPag: (venda.pagamentos || []).map((p) => ({ tPag: p.forma, vPag: arredondar2(p.valor) })),
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
