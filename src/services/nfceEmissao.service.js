/**
 * Arquivo: nfceEmissao.service.js
 * Responsabilidade: Emissão real de NFC-e (autorização), cancelamento e
 * contingência Nível 1 (SVC) — Fase 1c. Em desenvolvimento/teste
 * (SEFAZ_MOCK=true ou NODE_ENV=test), TUDO roda via mock — sem rede real e
 * sem usar o certificado de verdade; só fora disso a chamada de fato
 * acontece (mesmo padrão de SEFAZ_AMBIENTE já usado na Distribuição DF-e).
 *
 * ATENÇÃO — LIMITAÇÃO REAL DESCOBERTA NESTA FASE: a lib
 * @vexta-systems/node-mde (já usada pra Distribuição DF-e) só exporta
 * DistribuicaoNFe, RecepcaoEvento e DistribuicaoCTe — NÃO tem nenhuma
 * função de assinatura de XML nem de chamada ao NfeAutorizacao4 (a
 * operação SOAP que autoriza de fato um documento novo). Por isso:
 *   - EMISSÃO (chamarWebserviceReal): em modo NÃO-mock, lança um erro
 *     claro "não implementado" — assinar XML (XML-DSig) e montar a
 *     chamada ao NfeAutorizacao4 é trabalho novo, fora do que a lib atual
 *     cobre, e não deveria ser inventado às pressas numa função que emite
 *     documento fiscal de verdade.
 *   - CANCELAMENTO (enviarEventoCancelamentoReal): em modo não-mock, USA
 *     RecepcaoEvento (mesma classe já comprovada em produção pra
 *     manifestação do destinatário) — mas os campos extras do evento de
 *     cancelamento (nProt, xJust) foram inferidos por analogia ao padrão
 *     já existente (chNFe, tipoEvento), NÃO confirmados contra a
 *     documentação da lib. Testar em homologação real antes de habilitar
 *     em produção.
 *   - A lógica de RETRY pra contingência (Tarefa 4) é 100% real e testável
 *     independente disso — ela só decide "tentar de novo no SVC quando o
 *     principal falhar por conexão", não depende de como a chamada em si
 *     é implementada.
 *
 * Utilizado por: (controller/rota, fora deste prompt) fluxo de emissão
 * pós-venda e cancelamento de NFC-e.
 * Depende de: VendaRepository, SuperadminRepository, AuditoriaRepository,
 * configuracaoFiscal.service, nfceXml.service, tributoFiscal.service,
 * config/webservicesSefaz, sefaz.service (CODIGO_UF), utils/certcrypto,
 * @vexta-systems/node-mde (RecepcaoEvento).
 */
const { RecepcaoEvento } = require('@vexta-systems/node-mde');
const vendaRepo = require('../repositories/venda.repository');
const superadminRepo = require('../repositories/superadmin.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { configuracaoFiscalCompleta } = require('./configuracaoFiscal.service');
const { gerarXmlNfce } = require('./nfceXml.service');
const { calcularTributoItem } = require('./tributoFiscal.service');
const { resolverUrlsFiscais } = require('../config/webservicesSefaz');
const { CODIGO_UF } = require('./sefaz.service');
const { descriptografar, descriptografarTexto } = require('../utils/certcrypto');
const { AppError } = require('../utils/response');

const TP_EMIS_NORMAL = '1';
// SVC-RS — ver pendência de UF x SVC-AN/SVC-RS em config/webservicesSefaz.js.
const TP_EMIS_SVC_RS = '7';
const TIPO_EVENTO_CANCELAMENTO = 110111;
const JUSTIFICATIVA_MIN_CHARS = 15; // exigência padrão da SEFAZ pro evento de cancelamento

function mockAtivo() {
  return process.env.SEFAZ_MOCK === 'true' || process.env.NODE_ENV === 'test';
}

/** Recalcula o tributo de cada item no momento da emissão; item que já tem snapshot gravado não é recalculado. */
function itensComTributo(venda, tenant) {
  return venda.itens.map((item) => {
    if (item.cstIbsCbsAplicado) return item;
    const tributo = calcularTributoItem(tenant, item.produto, Number(item.total));
    return { ...item, ...tributo };
  });
}

/** Certificado descriptografado em memória — nunca gravado em disco. Só usado no caminho real (mock nem chega aqui). */
function certificadoEmMemoria(tenant) {
  if (!tenant.certificadoPfx)
    throw new AppError('Este supermercado não tem certificado digital cadastrado', 422);
  return {
    pfx: descriptografar(Buffer.from(tenant.certificadoPfx)),
    passphrase: tenant.certificadoSenha ? descriptografarTexto(tenant.certificadoSenha) : '',
  };
}

/** MOCK — sucesso determinístico, sem rede, sem certificado real. */
async function chamarWebserviceMock() {
  return { cStat: '100', xMotivo: 'Autorizado o uso da NF-e (MOCK)', protocolo: 'MOCK' + String(Date.now()).slice(-12) };
}

/** REAL — NÃO IMPLEMENTADO ainda (ver comentário no topo do arquivo). */
async function chamarWebserviceReal() {
  throw new AppError(
    'Emissão real de NFC-e ainda não implementada: a lib @vexta-systems/node-mde não expõe assinatura XML (XML-DSig) nem chamada ao NfeAutorizacao4 — só DistribuicaoNFe/RecepcaoEvento (consumo e eventos). Implemente isso antes de rodar com SEFAZ_MOCK=false em produção.',
    501
  );
}

/**
 * Tenta autorizar no webservice principal; se a chamada FALHAR (exceção —
 * conexão/timeout, nunca por rejeição de conteúdo, que a SEFAZ devolve
 * como cStat diferente de 100 sem lançar exceção), tenta de novo no SVC
 * (contingência), regenerando o XML/chave com o tpEmis de contingência.
 * Retorna { cStat, xMotivo, protocolo, xml, chaveAcesso, viaContingencia }.
 */
async function autorizarComContingencia(montarXmlComTpEmis, urls, chamador, tenant) {
  const normal = montarXmlComTpEmis(TP_EMIS_NORMAL);
  try {
    const resp = await chamador(urls.autorizacao, normal.xml, tenant);
    return { ...resp, ...normal, viaContingencia: false };
  } catch (erroConexaoPrincipal) {
    // AppError = erro já classificado (ex: 501 "não implementada", 422 de
    // validação) -- não é falha de conexão, não faz sentido tentar de novo
    // no SVC nem mascarar a mensagem com o 503 genérico abaixo.
    if (erroConexaoPrincipal instanceof AppError) throw erroConexaoPrincipal;

    const contingencia = montarXmlComTpEmis(TP_EMIS_SVC_RS);
    try {
      const resp = await chamador(urls.contingenciaSvc.autorizacao, contingencia.xml, tenant);
      return { ...resp, ...contingencia, viaContingencia: true };
    } catch (erroConexaoSvc) {
      if (erroConexaoSvc instanceof AppError) throw erroConexaoSvc;
      throw new AppError(
        'Não foi possível emitir a NFC-e: a SEFAZ do estado e o ambiente de contingência (SVC) estão indisponíveis. Aguarde a normalização antes de vender com nota fiscal — não é caso de tentar resolver programaticamente aqui (ver Fase 3 para fila local).',
        503
      );
    }
  }
}

/**
 * Emite a NFC-e: valida configuração fiscal completa, gera o XML, chama o
 * webservice (mock em dev/teste; real fora disso — ver limitação no topo
 * do arquivo) com contingência automática pro SVC, e grava a chave de
 * acesso REAL + protocolo em Venda.
 * `chamarWebservice(url, xml, tenant)` é injetável só pra teste (simular
 * sucesso/rejeição/conexão-fora-do-ar sem rede real); em uso normal nem
 * precisa ser passado — o mock/real padrão é escolhido sozinho.
 */
async function emitirNfce(tenantId, vendaId, { chamarWebservice } = {}) {
  const tenant = await superadminRepo.buscarTenantPorId(tenantId);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);

  const completude = await configuracaoFiscalCompleta(tenantId);
  if (!completude.completa)
    throw new AppError(`Configuração fiscal incompleta para emitir NFC-e. Faltando: ${completude.camposFaltantes.join(', ')}`, 422);

  const vendaCarregada = await vendaRepo.buscarParaEmissao(tenantId, vendaId);
  if (!vendaCarregada) throw new AppError('Venda não encontrada', 404);
  const venda = { ...vendaCarregada, tenant, itens: itensComTributo(vendaCarregada, tenant) };

  const urls = resolverUrlsFiscais(tenant.uf, tenant.ambienteFiscal);
  const chamador = chamarWebservice || (mockAtivo() ? chamarWebserviceMock : chamarWebserviceReal);

  const resultado = await autorizarComContingencia(
    (tpEmis) => gerarXmlNfce(venda, { tpEmis }),
    urls,
    chamador,
    tenant
  );

  // O XML é salvo SEMPRE, mesmo se a SEFAZ rejeitar (cStat != 100) — é o
  // registro do que foi de fato tentado enviar, não só do que foi aceito.
  // Por isso este update acontece antes do throw abaixo, numa única
  // chamada (nunca dois writes): os campos de autorização só entram no
  // mesmo objeto quando a emissão realmente é aceita.
  const dadosAtualizacao = { xmlNfce: resultado.xml };
  if (resultado.cStat === '100') {
    dadosAtualizacao.chaveNfce = resultado.chaveAcesso;
    dadosAtualizacao.emitidoEm = new Date();
    dadosAtualizacao.emitidoViaContingencia = resultado.viaContingencia;
    dadosAtualizacao.protocoloAutorizacao = resultado.protocolo;
  }
  const atualizada = await vendaRepo.atualizarStatus(tenantId, vendaId, dadosAtualizacao);

  if (resultado.cStat !== '100')
    throw new AppError(`NFC-e rejeitada pela SEFAZ: ${resultado.cStat} - ${resultado.xMotivo}`, 422);

  await auditoriaRepo.registrar({
    tenantId, acao: 'emitir_nfce', entidade: 'Venda', entidadeId: vendaId,
    depois: { chaveNfce: resultado.chaveAcesso, viaContingencia: resultado.viaContingencia },
  });

  return atualizada;
}

async function enviarEventoCancelamentoMock() {
  return { ok: true, protocolo: 'MOCKCANC' + String(Date.now()).slice(-10) };
}

/**
 * PENDENTE DE CONFIRMAÇÃO (ver nota no topo do arquivo): nProt/xJust
 * inferidos por analogia ao padrão já usado em sefaz.service.manifestar()
 * (chNFe, tipoEvento), não confirmados contra a documentação da lib.
 */
async function enviarEventoCancelamentoReal(tenant, venda, justificativa) {
  const cert = certificadoEmMemoria(tenant);
  const recepcao = new RecepcaoEvento({
    pfx: cert.pfx,
    passphrase: cert.passphrase,
    cnpj: tenant.cnpj,
    cUFAutor: CODIGO_UF[tenant.uf],
    tpAmb: tenant.ambienteFiscal === 'producao' ? '1' : '2',
    options: { requestOptions: { timeout: 60000 } },
  });
  const envio = await recepcao.enviarEvento({
    idLote: String(Date.now() % 1e15),
    lote: [{ chNFe: venda.chaveNfce, tipoEvento: TIPO_EVENTO_CANCELAMENTO, nProt: venda.protocoloAutorizacao, xJust: justificativa }],
  });
  if (envio.error)
    throw new AppError('Falha ao enviar cancelamento à SEFAZ: ' + JSON.stringify(envio.error).slice(0, 200), 502);

  const retornos = [].concat((envio.data && envio.data.retEvento) || []);
  const info = (retornos[0] && (retornos[0].infEvento || retornos[0])) || {};
  const cStat = String(info.cStat || '');
  // 135/155 = evento registrado (normal/extemporâneo) — mesmo estilo de
  // aceitar códigos próximos já usado em manifestar(); confirmar antes de produção.
  return ['135', '155'].includes(cStat)
    ? { ok: true, protocolo: info.nProt || '' }
    : { ok: false, motivo: cStat + ' - ' + (info.xMotivo || 'evento rejeitado') };
}

/**
 * Cancela a NFC-e (evento fiscal na SEFAZ) — checa janela de tempo por UF
 * (config/webservicesSefaz) e justificativa mínima antes de tentar
 * qualquer coisa. Em mock, simula sucesso; em real, envia o evento (ver
 * limitação no topo do arquivo).
 *
 * ESCOPO: isso cuida só do lado FISCAL (evento na SEFAZ + status/protocolo
 * da Venda). NÃO reverte estoque nem caixa — isso já é feito por
 * venda.service.cancelar() (intacto, não alterado); se o cancelamento
 * fiscal e o operacional precisarem andar juntos, quem chama esta função
 * (fora deste prompt) decide a ordem de acionar os dois.
 */
async function cancelarNfce(tenantId, vendaId, justificativa, { enviarEventoCancelamento } = {}) {
  if (!justificativa || justificativa.trim().length < JUSTIFICATIVA_MIN_CHARS)
    throw new AppError(`Justificativa do cancelamento deve ter pelo menos ${JUSTIFICATIVA_MIN_CHARS} caracteres`, 422);

  const tenant = await superadminRepo.buscarTenantPorId(tenantId);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);

  const venda = await vendaRepo.buscarParaEmissao(tenantId, vendaId);
  if (!venda) throw new AppError('Venda não encontrada', 404);
  if (!venda.chaveNfce) throw new AppError('Esta venda não tem NFC-e emitida — não há o que cancelar', 422);
  if (venda.status === 'cancelada') throw new AppError('Venda já cancelada', 409);

  const urls = resolverUrlsFiscais(tenant.uf, tenant.ambienteFiscal);
  const referencia = venda.emitidoEm || venda.criadoEm;
  const minutosDecorridos = (Date.now() - new Date(referencia).getTime()) / 60000;
  if (minutosDecorridos > urls.janelaCancelamentoMinutos)
    throw new AppError(
      `Prazo de cancelamento expirado: a janela é de ${urls.janelaCancelamentoMinutos} minutos após a emissão, e já se passaram ${Math.floor(minutosDecorridos)} minutos.`,
      422
    );

  const justificativaFinal = justificativa.trim();
  const enviar = enviarEventoCancelamento || (mockAtivo() ? enviarEventoCancelamentoMock : enviarEventoCancelamentoReal);
  const resultado = await enviar(tenant, venda, justificativaFinal);

  if (!resultado.ok)
    throw new AppError(`Cancelamento rejeitado pela SEFAZ: ${resultado.motivo}`, 422);

  const atualizada = await vendaRepo.atualizarStatus(tenantId, vendaId, {
    status: 'cancelada',
    canceladoEm: new Date(),
    motivoCancelamento: justificativaFinal,
    protocoloCancelamento: resultado.protocolo,
  });

  await auditoriaRepo.registrar({
    tenantId, acao: 'cancelar_nfce', entidade: 'Venda', entidadeId: vendaId,
    depois: { motivo: justificativaFinal },
  });

  return atualizada;
}

module.exports = { emitirNfce, cancelarNfce, mockAtivo };
