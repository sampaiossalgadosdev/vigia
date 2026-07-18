/**
 * Arquivo: nfceEmissao.service.js
 * Responsabilidade: Emissão real de NFC-e (autorização) e cancelamento —
 * Fase 1c. Em desenvolvimento/teste (SEFAZ_MOCK=true ou NODE_ENV=test),
 * TUDO roda via mock — sem rede real e sem usar o certificado de verdade;
 * só fora disso a chamada de fato acontece.
 *
 * SEM CONTINGÊNCIA SVC (decisão desta fase, revertendo uma tentativa
 * anterior): declarar contingência formal (tpEmis != 1) exige, desde a NT
 * 2025.001 (produção obrigatória desde 03/11/2025), QR Code versão 3 com
 * assinatura digital — mecanismo que não temos especificação técnica
 * completa pra implementar com segurança (a lib @nfewizard/nfce 1.0.4,
 * versão mais recente publicada, não suporta: gera QR Code sempre em v2,
 * sem nenhuma lógica condicional por tpEmis). Duas tentativas anteriores
 * de contornar isso (forçar UF:'SVRS' pra mirar o SVC; manter a UF real e
 * tentar mesmo assim) esbarraram nisso e foram revertidas. Em vez de
 * declarar contingência, `emitirNfce` faz UMA tentativa no webservice
 * principal; se falhar por conexão/timeout, propaga o erro direto — quem
 * chama (a fila assíncrona, filaEmissaoNfce.service.js, já implementada)
 * marca a venda como `falha_temporaria` e tenta de novo, na próxima
 * passada, o MESMO endpoint principal, até a SEFAZ do estado voltar. A
 * tabela `contingenciaSvc` em config/webservicesSefaz.js foi mantida
 * (não removida) como referência, caso isso seja implementado de verdade
 * no futuro com a especificação certa em mãos — só não é mais usada aqui.
 *
 * EMISSÃO/CANCELAMENTO REAIS (via @nfewizard/nfce — confirmado por
 * investigação estrutural contra a SEFAZ-PR de homologação com certificado
 * dummy, não só por documentação):
 *   - O validador de schema PADRÃO usado internamente pelo fluxo de
 *     autorização é Java-based, ao contrário do que a documentação da lib
 *     sugere — por isso `lib.useForSchemaValidation: 'validateSchemaJsBased'`
 *     é configurado EXPLICITAMENTE em NFE_LoadEnvironment (sem isso, toda
 *     emissão exigiria JDK em runtime, não só na instalação).
 *   - A lib joga fora o erro original ao relançar (`throw new
 *     Error('NFCE_Autorizacao: ' + error.message)`) — perde `.code`/
 *     `.isAxiosError`, então falha de conexão real e rejeição de conteúdo
 *     da SEFAZ (`verificaRejeicao` da lib lança exceção pros dois casos)
 *     chegam aqui como o mesmo tipo de erro genérico. `ehFalhaDeRede()`
 *     classifica por padrão de mensagem (conservador: só reconhece
 *     assinaturas conhecidas de falha de rede; o resto é tratado como
 *     rejeição de conteúdo) — usado só pra distinguir os dois casos, já
 *     que não há mais uma segunda tentativa que dependa dessa distinção.
 *   - Um novo `NFCEWizard` é criado e carregado a CADA chamada (nunca
 *     reaproveitado entre chamadas) — o Environment guarda certificado e
 *     CNPJ do tenant, e este é um serviço multi-tenant: reaproveitar uma
 *     instância entre chamadas arriscaria vazar certificado/config de um
 *     tenant para outro em requisições concorrentes.
 *
 * Utilizado por: (controller/rota, fora deste prompt) fluxo de emissão
 * pós-venda e cancelamento de NFC-e; filaEmissaoNfce.service.js (retry
 * assíncrono).
 * Depende de: VendaRepository, SuperadminRepository, AuditoriaRepository,
 * configuracaoFiscal.service, nfceXml.service, tributoFiscal.service,
 * config/webservicesSefaz, sefaz.service (CODIGO_UF), utils/certcrypto,
 * @nfewizard/nfce (NFCEWizard).
 */
const { NFCEWizard } = require('@nfewizard/nfce');
const prisma = require('../config/database');
const vendaRepo = require('../repositories/venda.repository');
const superadminRepo = require('../repositories/superadmin.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { configuracaoFiscalCompleta } = require('./configuracaoFiscal.service');
const { gerarXmlNfce, montarChaveAcessoPlaceholder } = require('./nfceXml.service');
const { calcularTributoItem } = require('./tributoFiscal.service');
const { listarIndicadoresCst, listarIndicadoresClassTrib, montarClassificacaoFiscal } = require('../repositories/catalogoFiscal.repository');
const { resolverUrlsFiscais } = require('../config/webservicesSefaz');
const { CODIGO_UF } = require('./sefaz.service');
const { descriptografar, descriptografarTexto } = require('../utils/certcrypto');
const { AppError } = require('../utils/response');

const TP_EMIS_NORMAL = '1';
const TIPO_EVENTO_CANCELAMENTO = '110111';
const JUSTIFICATIVA_MIN_CHARS = 15; // exigência padrão da SEFAZ pro evento de cancelamento

// Assinaturas conhecidas de falha de CONEXÃO (nunca de rejeição de
// conteúdo) nas mensagens que a lib relança — ver nota no topo do arquivo
// sobre por que isso é necessário (a lib não preserva o erro original).
const REGEX_ERRO_REDE = /EPROTO|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNABORTED|Network Error|timeout of \d+ms exceeded|socket hang up/i;

function mockAtivo() {
  return process.env.SEFAZ_MOCK === 'true' || process.env.NODE_ENV === 'test';
}

function ehFalhaDeRede(erro) {
  return REGEX_ERRO_REDE.test(erro.message || '');
}

/** Remove o prefixo que NFCEWizard adiciona ao relançar (ex: "NFCE_Autorizacao: "). */
function mensagemSemPrefixoDaLib(mensagem) {
  return String(mensagem || '').replace(/^NFCE_(Autorizacao|Cancelamento):\s*/, '');
}

/** Busca recursiva por uma chave em um objeto/array de profundidade arbitrária (o retorno bruto de NFCE_Cancelamento não tem formato documentado). */
function buscarChaveProfunda(obj, chave) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (chave in obj) return obj[chave];
  for (const valor of Object.values(obj)) {
    const encontrado = buscarChaveProfunda(valor, chave);
    if (encontrado !== undefined) return encontrado;
  }
  return undefined;
}

/**
 * Reserva o número sequencial REAL da NFC-e (série 1, emissão normal) —
 * mesmo padrão de produto.repository.criarComCodigoSequencial
 * (Tenant.ultimoCodigoReferencia): incrementa Tenant.ultimoNumeroNfce
 * atomicamente dentro de uma transação e grava o valor em Venda.numeroNfce,
 * pra nunca reservar dois números pra mesma venda.
 * `numeroExistente` (Venda.numeroNfce já lido) faz a reserva ser IDEMPOTENTE
 * por venda: se a venda já tentou emitir antes (retry por falha de conexão,
 * ver filaEmissaoNfce.service), o MESMO número é reaproveitado — reservar
 * de novo a cada tentativa "gastaria" um número por tentativa falha,
 * criando buracos na sequência que exigiriam inutilização formal na SEFAZ.
 */
async function reservarNumeroNfce(tenantId, vendaId, numeroExistente) {
  if (numeroExistente) return numeroExistente;
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { ultimoNumeroNfce: { increment: 1 } },
    });
    await tx.venda.update({ where: { id: vendaId }, data: { numeroNfce: tenant.ultimoNumeroNfce } });
    return tenant.ultimoNumeroNfce;
  });
}

/**
 * Reserva número + CHAVE DE ACESSO de uma vez, de forma SÍNCRONA, DENTRO de
 * uma transação já aberta por quem chama (`tx` — venda.service.
 * registrarDentroDaTransacao). Existe pra resolver um problema real: o
 * DANFE precisa ser impresso NO MOMENTO da venda (o cliente está no caixa
 * esperando), mas a emissão de verdade (chamada à SEFAZ) roda depois, num
 * worker assíncrono (filaEmissaoNfce.service, até
 * INTERVALO_PROCESSAMENTO_MINUTOS de atraso) — sem isto, a chave de acesso
 * (e o QR Code que vai no DANFE) simplesmente não existiriam ainda no
 * instante em que o cupom precisa sair impresso.
 * NÃO usa reservarNumeroNfce acima (que abre sua PRÓPRIA transação) —
 * precisa rodar dentro da MESMA transação que cria a Venda: se essa
 * transação de fora reverter (ex: retry por lock timeout, já existe em
 * venda.service.registrar), o incremento do contador reverte junto, sem
 * deixar buraco na sequência.
 * A chave calculada aqui é DEFINITIVA — gerarXmlNfce (nfceXml.service),
 * quando o worker assíncrono chamar depois, REAPROVEITA ela tal como está
 * (ver nota lá) em vez de recalcular, pra nunca divergir do que já foi
 * impresso e entregue ao cliente.
 * Só chamada quando a venda tem configuração fiscal completa e NÃO é uma
 * contingência já assinada (ver venda.service.registrar) — nesses dois
 * outros casos não faz sentido reservar aqui.
 */
async function reservarNumeroEChaveNfceNaTransacao(tx, tenantId, tenant, dataVenda) {
  const tenantAtualizado = await tx.tenant.update({
    where: { id: tenantId },
    data: { ultimoNumeroNfce: { increment: 1 } },
  });
  const numero = tenantAtualizado.ultimoNumeroNfce;
  const cNF = Math.floor(Math.random() * 99999999);
  const chaveAcesso = montarChaveAcessoPlaceholder(tenant, { numero, cNF, dataEmissao: dataVenda, tpEmis: TP_EMIS_NORMAL });
  return { numero, chaveAcesso };
}

/**
 * Recalcula o tributo de cada item no momento da emissão; item que já tem
 * snapshot gravado não é recalculado. Busca os indicadores fiscais
 * (CatalogoCstIbsCbs/CatalogoClassTrib) EM LOTE — 2 queries fixas pra
 * venda inteira, não 2 por item — e monta um mapa em memória pra resolver
 * cada produto (mesmo padrão de pdvSnapshot.service.js; os catálogos são
 * pequenos e globais, 18/164 códigos ao todo, cabem inteiros em memória).
 * Achado de revisão (2026-07-18): a versão anterior buscava por item
 * (buscarClassificacaoFiscal, 2 queries cada), gerando até 2×N consultas
 * numa venda com N itens — desnecessário e inconsistente com o padrão já
 * usado em pdvSnapshot.service.js no mesmo diff.
 * Só busca no catálogo se pelo menos um item ainda precisar de
 * classificação (evita a query em lote à toa quando tudo já veio com
 * snapshot gravado).
 */
async function itensComTributo(venda, tenant) {
  const precisaResolver = venda.itens.some((item) => !item.cstIbsCbsAplicado);
  const [indicadoresCst, indicadoresClassTrib] = precisaResolver
    ? await Promise.all([listarIndicadoresCst(), listarIndicadoresClassTrib()])
    : [[], []];
  const mapaCst = new Map(indicadoresCst.map((c) => [c.codigo, c]));
  const mapaClassTrib = new Map(indicadoresClassTrib.map((c) => [c.codigo, c]));

  return venda.itens.map((item) => {
    if (item.cstIbsCbsAplicado) return item;
    const classificacaoFiscal = montarClassificacaoFiscal(mapaCst.get(item.produto.cstIbsCbs), mapaClassTrib.get(item.produto.cClassTrib));
    const tributo = calcularTributoItem(tenant, item.produto, Number(item.total), classificacaoFiscal);
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

/**
 * Carrega um NFCEWizard novo (nunca reaproveitado entre chamadas — ver nota
 * no topo do arquivo) com o certificado do tenant já descriptografado em
 * memória. A lib resolve a URL do webservice e a URL do QR Code a partir
 * de `dfe.UF` — sempre a UF real do tenant (nunca sobrescrita, ver nota
 * "SEM CONTINGÊNCIA SVC" no topo do arquivo).
 */
async function carregarAmbienteNfce(tenant) {
  const cert = certificadoEmMemoria(tenant);
  const producao = tenant.ambienteFiscal === 'producao';
  const wizard = new NFCEWizard();
  try {
    await wizard.NFE_LoadEnvironment({
      config: {
        dfe: {
          armazenarXMLAutorizacao: false,
          armazenarXMLRetorno: false,
          armazenarXMLConsulta: false,
          pathCertificado: cert.pfx,
          senhaCertificado: cert.passphrase,
          UF: tenant.uf,
          CPFCNPJ: tenant.cnpj,
        },
        nfe: {
          ambiente: producao ? 1 : 2,
          versaoDF: '4.00',
          idCSC: Number(producao ? tenant.cscProducaoId : tenant.cscHomologacaoId),
          tokenCSC: descriptografarTexto(producao ? tenant.cscProducao : tenant.cscHomologacao),
        },
        lib: {
          connection: { timeout: 30000 },
          log: { exibirLogNoConsole: false, armazenarLogs: false },
          // Achado de investigação: o padrão real (sem isto) é Java-based —
          // ver comentário no topo do arquivo.
          useForSchemaValidation: 'validateSchemaJsBased',
        },
      },
    });
  } catch (erro) {
    // Certificado corrompido/senha errada é um erro JÁ CLASSIFICADO (não é
    // falha de conexão nem rejeição de conteúdo da SEFAZ) -- vira AppError
    // com o motivo real, em vez de deixar a lib lançar algo genérico que
    // se pareceria com falha de conexão.
    throw new AppError('Certificado digital inválido ou senha incorreta: ' + mensagemSemPrefixoDaLib(erro.message), 422);
  }
  return wizard;
}

/**
 * REAL — usa @nfewizard/nfce. Chamada única (sem contingência SVC — ver
 * nota no topo do arquivo). `url` é recebido por simetria com o
 * `chamarWebservice` injetável de teste, mas não é usado: a lib resolve o
 * endpoint sozinha a partir de `dfe.UF` (carregado com a UF real do
 * tenant em `carregarAmbienteNfce`), não aceita URL literal por chamada.
 *
 * Falha de conexão real (`ehFalhaDeRede`) propaga como exceção — quem
 * chama (`emitirNfce`, e por trás dela `processarFilaEmissao`) decide o
 * que fazer (hoje: marcar falha_temporaria e deixar a fila tentar de
 * novo depois). Rejeição de CONTEÚDO da SEFAZ (a lib lança exceção pros
 * dois casos, joga fora o cStat estruturado — ver nota no topo do
 * arquivo) NÃO propaga como exceção — vira um retorno normal
 * `{cStat, xMotivo}`, pra `emitirNfce` gravar o XML e rejeitar com o
 * motivo real, sem reagendar retry (uma rejeição de conteúdo não se
 * resolve tentando de novo sem correção manual).
 */
async function chamarWebserviceReal(url, xml, tenant) {
  const wizard = await carregarAmbienteNfce(tenant);

  let xmls;
  try {
    xmls = await wizard.NFCE_Autorizacao(xml);
  } catch (erro) {
    if (ehFalhaDeRede(erro)) throw erro;

    // cStat extraído é best-effort (só a mensagem de texto sobrevive à
    // lib); xMotivo real é preservado.
    const cStatExtraido = (erro.message.match(/\b(\d{3})\b/) || [])[1] || '999';
    return { cStat: cStatExtraido, xMotivo: mensagemSemPrefixoDaLib(erro.message), protocolo: '' };
  }

  const infProt = (xmls && xmls[0] && xmls[0].protNFe && xmls[0].protNFe.infProt) || {};
  return { cStat: String(infProt.cStat || ''), xMotivo: infProt.xMotivo || '', protocolo: infProt.nProt || '' };
}

/**
 * Tenta autorizar no webservice principal — UMA VEZ, sem contingência SVC
 * (ver nota "SEM CONTINGÊNCIA SVC" no topo do arquivo). Qualquer falha
 * (conexão/timeout, certificado inválido, rejeição de conteúdo já
 * convertida em retorno normal por `chamador`) segue o comportamento
 * natural de `chamador`: exceção propaga direto pra quem chamou
 * `autorizarNfce` decidir (hoje: `emitirNfce` não trata nada especial,
 * só deixa subir; `processarFilaEmissao` é quem classifica e agenda
 * retry). Retorna { cStat, xMotivo, protocolo, xml, chaveAcesso }.
 */
async function autorizarNfce(montarXmlComTpEmis, urls, chamador, tenant) {
  const dados = montarXmlComTpEmis(TP_EMIS_NORMAL);
  const resp = await chamador(urls.autorizacao, dados.xml, tenant);
  return { ...resp, ...dados };
}

/**
 * Emite a NFC-e: valida configuração fiscal completa, gera o XML, chama o
 * webservice UMA VEZ (mock em dev/teste; real fora disso — ver notas no
 * topo do arquivo; sem contingência SVC), e grava a chave de acesso REAL
 * + protocolo em Venda.
 * `chamarWebservice(url, xml, tenant)` é injetável só pra teste (simular
 * sucesso/rejeição/conexão-fora-do-ar sem rede real); em uso normal nem
 * precisa ser passado — o mock/real padrão é escolhido sozinho. Falha de
 * conexão propaga direto daqui — quem chama trata (a fila assíncrona,
 * filaEmissaoNfce.service.js, marca falha_temporaria e tenta de novo
 * depois).
 */
async function emitirNfce(tenantId, vendaId, { chamarWebservice } = {}) {
  const tenant = await superadminRepo.buscarTenantPorId(tenantId);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);

  const completude = await configuracaoFiscalCompleta(tenantId);
  if (!completude.completa)
    throw new AppError(`Configuração fiscal incompleta para emitir NFC-e. Faltando: ${completude.camposFaltantes.join(', ')}`, 422);

  const vendaCarregada = await vendaRepo.buscarParaEmissao(tenantId, vendaId);
  if (!vendaCarregada) throw new AppError('Venda não encontrada', 404);
  const numeroNfce = await reservarNumeroNfce(tenantId, vendaId, vendaCarregada.numeroNfce);
  const venda = { ...vendaCarregada, numeroNfce, tenant, itens: await itensComTributo(vendaCarregada, tenant) };

  const urls = resolverUrlsFiscais(tenant.uf, tenant.ambienteFiscal);
  const chamador = chamarWebservice || (mockAtivo() ? chamarWebserviceMock : chamarWebserviceReal);

  const resultado = await autorizarNfce(
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
    dadosAtualizacao.protocoloAutorizacao = resultado.protocolo;
  }
  const atualizada = await vendaRepo.atualizarStatus(tenantId, vendaId, dadosAtualizacao);

  if (resultado.cStat !== '100')
    throw new AppError(`NFC-e rejeitada pela SEFAZ: ${resultado.cStat} - ${resultado.xMotivo}`, 422);

  await auditoriaRepo.registrar({
    tenantId, acao: 'emitir_nfce', entidade: 'Venda', entidadeId: vendaId,
    depois: { chaveNfce: resultado.chaveAcesso },
  });

  return atualizada;
}

async function enviarEventoCancelamentoMock() {
  return { ok: true, protocolo: 'MOCKCANC' + String(Date.now()).slice(-10) };
}

/**
 * REAL — usa @nfewizard/nfce (NFCEWizard.NFCE_Cancelamento). Formato
 * CONFIRMADO lendo o .d.ts real e testado estruturalmente contra a
 * SEFAZ-PR de homologação (não mais inferido por analogia): nProt/xJust
 * ficam aninhados em `evento[].detEvento`, não soltos como se assumia
 * antes.
 *
 * dhEvento usa offset fixo de -03:00 (horário de Brasília, sem horário de
 * verão desde 2019) — ASSUNÇÃO fica registrada aqui: incorreta para
 * tenants em UF com fuso diferente (AC, oeste do AM), que hoje não têm
 * tratamento especial em nenhum lugar do sistema (mesma simplificação já
 * documentada em outros pontos da Fase 1c, ex: config/webservicesSefaz.js).
 */
async function enviarEventoCancelamentoReal(tenant, venda, justificativa) {
  const wizard = await carregarAmbienteNfce(tenant);
  const producao = tenant.ambienteFiscal === 'producao';
  const dhEvento = new Date().toISOString().replace(/\.\d{3}Z$/, '-03:00');

  let resposta;
  try {
    resposta = await wizard.NFCE_Cancelamento({
      idLote: Date.now(),
      modelo: '65',
      evento: [{
        tpAmb: producao ? 1 : 2,
        cOrgao: CODIGO_UF[tenant.uf],
        CNPJ: tenant.cnpj,
        chNFe: venda.chaveNfce,
        dhEvento,
        tpEvento: TIPO_EVENTO_CANCELAMENTO,
        nSeqEvento: 1,
        verEvento: '1.00',
        detEvento: {
          descEvento: 'Cancelamento',
          nProt: venda.protocoloAutorizacao,
          xJust: justificativa,
        },
      }],
    });
  } catch (erro) {
    // Mesma ressalva de chamarWebserviceReal: a lib joga fora o erro
    // original, então distinguimos falha de conexão (502, igual ao
    // comportamento anterior) de rejeição de conteúdo (422, com o motivo
    // real) só pela mensagem.
    if (ehFalhaDeRede(erro))
      throw new AppError('Falha ao enviar cancelamento à SEFAZ: ' + mensagemSemPrefixoDaLib(erro.message), 502);
    return { ok: false, motivo: mensagemSemPrefixoDaLib(erro.message) };
  }

  // xMotivos[] (confirmado no .cjs) só traz {chNFe, xMotivo, cStat,
  // tipoEvento} -- sem nProt. O protocolo de fato só existe dentro de
  // `response` (JSON bruto da SEFAZ, formato/aninhamento não documentado
  // publicamente), daí a busca profunda em vez de indexar um caminho fixo.
  const info = (resposta && resposta.xMotivos && resposta.xMotivos[0]) || {};
  const protocolo = buscarChaveProfunda(resposta && resposta.response, 'nProt');
  return { ok: true, protocolo: protocolo || '' };
}

/**
 * Cancela a NFC-e (evento fiscal na SEFAZ) — checa janela de tempo por UF
 * (config/webservicesSefaz) e justificativa mínima antes de tentar
 * qualquer coisa. Em mock, simula sucesso; em real, envia o evento (ver
 * notas no topo do arquivo).
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

module.exports = {
  emitirNfce,
  cancelarNfce,
  mockAtivo,
  reservarNumeroNfce,
  reservarNumeroEChaveNfceNaTransacao,
  // Exportado só para o teste de integração manual (TESTE_INTEGRACAO_SEFAZ=true)
  // exercitar a chamada real à SEFAZ diretamente, sem depender de
  // gerarXmlNfce (que ainda não é schema-completo — ver ressalva na
  // resposta desta fase sobre o XML gerado pela Fase 1b).
  chamarWebserviceReal,
};
