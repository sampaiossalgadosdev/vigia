const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/database');
const vendaRepo = require('../repositories/venda.repository');
const produtoRepo = require('../repositories/produto.repository');
const promocaoRepo = require('../repositories/promocao.repository');
const caixaRepo = require('../repositories/caixa.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const estoqueDepositoService = require('../services/estoqueDeposito.service');
const loteService = require('../services/lote.service');
const loteRepo = require('../repositories/lote.repository');
const { configuracaoFiscalCompleta } = require('../services/configuracaoFiscal.service');
const { reservarNumeroEChaveNfceNaTransacao, resolverCancelamentoNfce, aplicarCancelamentoNfce } = require('../services/nfceEmissao.service');
const { montarUrlQrCode } = require('../services/nfceXml.service');
const { resolverUrlsFiscais } = require('../config/webservicesSefaz');
const logger = require('../logs/logger');
const { AppError, paginado } = require('../utils/response');

function normalizarPreco(preco, desconto, tipo) {
  if (tipo === 'percentual') return Number(preco) * (1 - Number(desconto) / 100);
  if (tipo === 'valor_fixo') return Math.max(0, Number(preco) - Number(desconto));
  return Number(preco);
}

const TOLERANCIA_RELOGIO_MS = 5 * 60 * 1000;

// Concorrência real no consumo de lote (múltiplos caixas vendendo do mesmo
// lote — escala confirmada: até 6 caixas por loja). TETO DE SEGURANÇA, não
// expectativa de espera normal: a seção travada (FOR UPDATE em
// lote.repository.listarAtivosParaConsumo) é só leitura+cálculo+escrita
// local, sem chamada de rede (confirmado por leitura de código) — em
// operação normal a trava deve resolver bem mais rápido que isto.
const LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '3s'";
// 1 tentativa original + 2 retries. Intervalo com jitter pra não
// sincronizar retries entre transações que colidiram ao mesmo tempo.
const MAX_TENTATIVAS_TRANSACAO = 3;
const RETRY_MIN_MS = 150;
const RETRY_MAX_MS = 300;
// Acima do lock_timeout (3s) com margem: uma venda pode ter mais de um
// produto com controlaLote, cada um fazendo sua própria espera de trava —
// sem essa margem, o timeout PADRÃO do Prisma (5s) poderia abortar a
// transação inteira antes do lock_timeout do Postgres, mascarando o erro
// específico de trava com o genérico "Transaction already closed".
const TRANSACTION_TIMEOUT_MS = 10000;

/** Erro de lock_timeout do Postgres (55P03) via FOR UPDATE — distinto de estoque insuficiente (AppError de negócio, sem .code). Confirmado empiricamente (não presumido) contra o banco real antes desta implementação. */
function ehErroDeLockTimeout(erro) {
  return Boolean(erro && erro.code === 'P2010' && erro.meta && erro.meta.code === '55P03');
}

/**
 * Erro de CONEXÃO transitória com o Postgres (proxy do Railway derrubando
 * conexões sob carga — reproduzido repetidas vezes durante os testes desta
 * sessão, sempre resolvido numa nova tentativa, sempre com o banco em si de
 * pé — confirmado via SELECT 1 direto nas ocasiões em que aconteceu).
 * Duas formas observadas, tratadas separadamente porque nenhuma sozinha
 * cobre as duas (achado de revisão 2026-07-20, checado empiricamente
 * contra este projeto, não só presumido da documentação):
 *   1. PrismaClientInitializationError — a conexão nem chega a se
 *      estabelecer (P1001 "Can't reach database server", P1008 "Operation
 *      timeout"). O discriminador é `instanceof`, não o código: um teste
 *      isolado (conexão apontada pra um host inalcançável, mesmo cenário
 *      de P1001) mostrou e.code E e.errorCode undefined nessa classe nesta
 *      versão do Prisma (5.22.0) — se essa função checasse erro.errorCode
 *      === 'P1001' (como a documentação oficial sugere), teria deixado
 *      passar exatamente o caso que ela precisa pegar.
 *   2. PrismaClientKnownRequestError com code='P1017' ("Server has closed
 *      the connection") — uma conexão que JÁ estava funcionando é fechada
 *      pelo servidor no meio de uma query (o padrão mais comum visto nos
 *      testes desta sessão). Mensagem como rede de segurança adicional
 *      (não só o code) porque, ao contrário do caso 1, não foi possível
 *      reproduzir isso sob controle pra confirmar e.code='P1017' de forma
 *      100% direta — só contra falhas reais e não-determinísticas.
 * Distinto de erro de negócio (AppError, sem .code) e de lock_timeout
 * (P2010/55P03, ver ehErroDeLockTimeout) — nenhum dos dois deve cair aqui.
 */
function ehErroDeConexaoTransitoria(erro) {
  if (!erro) return false;
  if (erro instanceof Prisma.PrismaClientInitializationError) return true;
  if (erro instanceof Prisma.PrismaClientKnownRequestError && (erro.code === 'P1017' || /server has closed the connection/i.test(erro.message || '')))
    return true;
  return false;
}

function aguardarComJitter() {
  const ms = RETRY_MIN_MS + Math.random() * (RETRY_MAX_MS - RETRY_MIN_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Roda `callback` dentro de uma prisma.$transaction, retentando
 * automaticamente em lock_timeout (P2010/55P03) OU conexão transitória com
 * o Postgres (ver ehErroDeLockTimeout/ehErroDeConexaoTransitoria) — até
 * MAX_TENTATIVAS_TRANSACAO vezes, com um atraso curto e aleatório entre
 * tentativas. Extraído nesta sessão (achado 2026-07-20): registrar() e
 * cancelar() precisavam exatamente do mesmo retry em volta de transações
 * diferentes — duplicar esse loop é o tipo de coisa que diverge em
 * silêncio na próxima vez que alguém lembrar de mexer só num dos dois.
 * `SET LOCAL lock_timeout` roda ANTES do callback em toda chamada — é
 * barato mesmo quando a transação não esbarra em nenhuma trava, e evita
 * que uma espera de lock (ex: FOR UPDATE de outra venda no mesmo lote)
 * vire um erro de timeout genérico da transação (10s, TRANSACTION_TIMEOUT_MS)
 * em vez do erro específico e já tratado por ehErroDeLockTimeout.
 * Nunca retenta erro de negócio (AppError sem .code) — propaga na hora.
 */
async function executarTransacaoComRetry(callback) {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_TRANSACAO; tentativa++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(LOCK_TIMEOUT_SQL);
        return callback(tx);
      }, { timeout: TRANSACTION_TIMEOUT_MS });
    } catch (erro) {
      const retentavel = ehErroDeLockTimeout(erro) || ehErroDeConexaoTransitoria(erro);
      if (retentavel && tentativa < MAX_TENTATIVAS_TRANSACAO) {
        await aguardarComJitter();
        continue;
      }
      if (retentavel) throw new AppError('Sistema ocupado, tente novamente', 503);
      throw erro;
    }
  }
}

/**
 * Valida o dataVenda opcional vindo do fluxo de sync (único caminho
 * autorizado a informar esse campo — ver registrar()). Sem limite de
 * quão antigo pode ser (uma queda de internet longa é cenário legítimo;
 * a fila de emissão já trata urgência crescente pra isso). Tolerância de
 * alguns minutos no futuro cobre diferença de relógio entre PDV e servidor.
 */
function validarDataVenda(dataVenda) {
  if (dataVenda === undefined || dataVenda === null) return undefined;
  const data = new Date(dataVenda);
  if (Number.isNaN(data.getTime())) throw new AppError('dataVenda inválida', 422);
  if (data.getTime() > Date.now() + TOLERANCIA_RELOGIO_MS)
    throw new AppError('dataVenda não pode estar no futuro', 422);
  return data;
}

async function listar(tenantId, query, pag) {
  const { items, total } = await vendaRepo.listar(tenantId, query, { skip: pag.skip, take: pag.limit });
  return paginado(items, total, pag.page, pag.limit);
}

async function detalhar(tenantId, id) {
  const venda = await vendaRepo.buscarPorId(tenantId, id);
  if (!venda) throw new AppError('Venda não encontrada', 404);
  return venda;
}

/**
 * `opcoes.dataVenda`: momento real da venda, só aceito no fluxo de sync em
 * lote (ver sync() abaixo, único chamador que preenche isso). O caminho
 * online normal (venda.controller.registrar → aqui) nunca passa essa
 * opção — e este código NUNCA lê `body.dataVenda`, então mesmo que um
 * client malicioso mande esse campo no body de POST /api/vendas, ele é
 * ignorado silenciosamente (nem chega a ser olhado). Isso evita que uma
 * venda online seja retroagida por manipulação de payload.
 *
 * `body.contingencia` (contingência off-line de NFC-e — ver
 * vigia-pdv/.../services/vendaContingencia.js e
 * nfceContingenciaTransmissao.service.js): só é honrado no MESMO fluxo de
 * sync em lote que aceita dataVenda (POST /api/vendas normal nunca lê esse
 * campo, mesma razão de segurança). Quando
 * `body.contingencia.assinado === true`, a venda JÁ TEM um XML de NFC-e
 * válido — assinado fora do backend, pelo app ASSINATURA da loja, no
 * momento exato da venda (tpEmis=9, chave de acesso e QR Code próprios,
 * já em posse do cliente no cupom impresso). Por isso:
 *   - chaveNfce/xmlNfce gravados JÁ SÃO os definitivos (não um localId
 *     provisório) — NUNCA passam pelo gerador normal (nfceXml.service),
 *     que criaria um documento DIFERENTE do que o cliente já recebeu.
 *   - statusEmissaoFiscal vai direto para 'contingencia_pendente_transmissao'
 *     (nunca 'pendente') — filaEmissaoNfce.processarFilaEmissao NUNCA
 *     pega esse status; só o worker dedicado
 *     (filaTransmissaoContingencia.service) transmite esse XML já pronto
 *     à SEFAZ. Sem essa distinção, o worker normal geraria e assinaria uma
 *     SEGUNDA NFC-e do zero pra mesma venda (chave/número diferentes),
 *     duplicando o documento fiscal.
 * Quando a assinatura em contingência falhou no PDV (`assinado === false`
 * ou campo ausente), o comportamento é o de sempre: 'pendente' (ou
 * 'nao_aplicavel'), pro fluxo normal tentar emitir ao sincronizar.
 */
async function registrar(tenantId, body, usuario, ip, opcoes = {}) {
  const caixaAberto = await caixaRepo.buscarAberto(tenantId);
  if (!caixaAberto) throw new AppError('Abra um caixa antes de registrar vendas', 422);

  // Fila assíncrona de emissão (complemento Fase 1c/3): NENHUMA chamada à
  // SEFAZ acontece no fluxo de venda — isso continua rodando à parte, no
  // worker (filaEmissaoNfce.service.processarFilaEmissao). O que MUDOU
  // (fatia DANFE): número + chave de acesso agora são reservados de forma
  // SÍNCRONA aqui (ver tenantParaChave/registrarDentroDaTransacao abaixo)
  // — só isso, sem rede, um increment atômico no Tenant — pra o DANFE
  // poder ser impresso na hora, com QR Code válido, sem esperar o worker.
  const { completa: fiscalCompleta } = await configuracaoFiscalCompleta(tenantId);

  const dataVenda = validarDataVenda(opcoes.dataVenda);

  // Só o fluxo de sync em lote pode informar contingência já assinada —
  // ver nota acima. `opcoes.contingencia` (não body.contingencia
  // diretamente) é o único jeito de chegar aqui, mesmo padrão de
  // opcoes.dataVenda.
  const contingencia = opcoes.contingencia;
  const contingenciaAssinada = !!(contingencia && contingencia.assinado);
  if (contingenciaAssinada && (!contingencia.chaveAcesso || !contingencia.xmlAssinado))
    throw new AppError('Contingência marcada como assinada mas sem chaveAcesso/xmlAssinado', 422);

  // Reserva número+chave de acesso SÍNCRONA (dentro da mesma transação que
  // cria a Venda, ver registrarDentroDaTransacao) só quando a venda vai
  // MESMO entrar na fila normal de emissão (fiscalCompleta && não é
  // contingência já assinada) — pro DANFE poder ser impresso na hora, sem
  // esperar o worker assíncrono processar (ver nfceEmissao.service.
  // reservarNumeroEChaveNfceNaTransacao). Só uf/cnpj/ambienteFiscal — não
  // reaproveita superadminRepo.buscarTenantPorId (traria o certificado e
  // os CSCs à toa, pra fora do lugar que já lida com esses segredos).
  const tenantParaChave = (fiscalCompleta && !contingenciaAssinada)
    ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { uf: true, cnpj: true, ambienteFiscal: true } })
    : null;

  const payload = {
    venda: {
      tenantId,
      operadorId: usuario.id,
      subtotal: 0,
      total: 0,
      desconto: Number(body.desconto || 0),
      troco: Number(body.troco || 0),
      cpfConsumidor: body.cpfConsumidor || null,
      // localId (Fase 3b) nunca vai para chaveNfce — são campos distintos
      // desde a correção do bug de dedup (ver comentário em schema.prisma).
      // body.chaveNfce só existiria num caso legado/raro; hoje nada envia isso.
      localId: body.localId || null,
      chaveNfce: contingenciaAssinada ? contingencia.chaveAcesso : (body.chaveNfce || null),
      xmlNfce: contingenciaAssinada ? contingencia.xmlAssinado : null,
      statusEmissaoFiscal: contingenciaAssinada
        ? 'contingencia_pendente_transmissao'
        : (fiscalCompleta ? 'pendente' : 'nao_aplicavel'),
      // Ausente quando não informado: o @default(now()) do schema assume,
      // idêntico ao comportamento de antes desta mudança.
      ...(dataVenda ? { dataVenda } : {}),
    },
    itens: [],
    pagamentos: [],
  };

  const itens = body.itens || [];
  if (itens.length === 0) throw new AppError('A venda precisa ter ao menos um item', 422);
  for (const item of itens) {
    const produto = await produtoRepo.buscarPorId(tenantId, item.produtoId);
    if (!produto || !produto.ativo) throw new AppError('Produto não encontrado', 404);

    const promocao = await promocaoRepo.buscarAtivaPorProduto(tenantId, produto.id);
    const precoBase = Number(produto.preco);
    let precoFinal = precoBase;
    let promocaoId = null;
    if (promocao && new Date(promocao.dataFim) >= new Date()) {
      precoFinal = normalizarPreco(precoBase, promocao.desconto, promocao.tipo);
      promocaoId = promocao.id;
    }

    const qtd = Number(item.quantidade);
    if (!(qtd > 0)) throw new AppError(`Quantidade inválida para o produto ${produto.nome}`, 422);
    const subtotal = precoFinal * qtd;
    payload.itens.push({
      // Gerado no client (não deixado pro default do Prisma) porque
      // createMany não retorna os ids criados, e o rastreio de lote
      // (VendaItemLote) precisa do vendaItemId antes de continuar.
      id: crypto.randomUUID(),
      produtoId: produto.id,
      quantidade: qtd,
      precoUnitario: precoFinal,
      custoUnitario: Number(produto.custoMedio || 0),
      desconto: 0,
      subtotal,
      total: subtotal,
      promocaoId,
    });
    payload.venda.subtotal += subtotal;
    payload.venda.total += subtotal;
  }

  if (payload.venda.desconto < 0) throw new AppError('Desconto não pode ser negativo', 422);
  if (payload.venda.desconto > payload.venda.subtotal) throw new AppError('Desconto não pode ser maior que o subtotal da venda', 422);

  payload.venda.total = Math.max(0, payload.venda.total - Number(payload.venda.desconto));
  payload.pagamentos = (body.pagamentos || []).map((p) => ({ forma: p.forma, valor: Number(p.valor) }));

  // Troco NUNCA é derivado de pagamentos (achado de revisão 2026-07-19,
  // pesquisa NT 2016.002/regra YA09-10): VendaPagamento.valor precisa
  // continuar sendo o valor LÍQUIDO de cada pagamento, igual a sempre — é o
  // que registrarDentroDaTransacao (linhas ~311-316, Caixa.totalDinheiro/
  // totalCartao/totalPix) e dashboard.repository.vendasPorFormaPagamento
  // somam pra conciliação de caixa e pro dashboard. Se dinheiro viesse com
  // o valor TENDERIZADO (recebido do cliente, maior que o total), as duas
  // contas ficariam infladas pelo troco. Por isso o client (Pagamento.jsx)
  // manda o troco JÁ CALCULADO em body.troco — igual a body.desconto logo
  // acima — em vez de embutir o valor tenderizado em pagamentos[].valor.
  // O valor tenderizado só é reconstruído (valor + troco) na hora de montar
  // o XML fiscal — ver nfceXml.service.montarGrupoPagamento — nunca aqui.
  if (payload.venda.troco < 0) throw new AppError('Troco não pode ser negativo', 422);
  if (payload.venda.troco > 0 && !payload.pagamentos.some((p) => p.forma === 'dinheiro'))
    throw new AppError('Troco só é válido quando há pagamento em dinheiro', 422);

  const venda = await executarTransacaoComRetry((tx) =>
    registrarDentroDaTransacao(tx, tenantId, usuario, ip, payload, caixaAberto, tenantParaChave)
  );

  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'Venda', entidadeId: venda.id, depois: { total: String(venda.total) }, ip });
  return venda;
}

/**
 * Corpo original da transação de registrar() (extraído pra função própria
 * só pra poder ser reexecutado pelo retry acima sem duplicar código) —
 * nenhuma mudança de lógica de negócio aqui, só o SET LOCAL lock_timeout
 * (feito por quem chama, logo antes desta função) e o uso de
 * loteRepo.listarAtivosParaConsumo (com FOR UPDATE) dentro de
 * loteService.consumirVendaFifo.
 * `tenantParaChave` (novo): quando presente, reserva número+chave de
 * acesso de forma síncrona ANTES de criar a Venda — ver nota em
 * registrar() e nfceEmissao.service.reservarNumeroEChaveNfceNaTransacao.
 * Rodar isso DENTRO desta transação (não antes, não numa separada) é o que
 * garante que um retry por lock timeout não "gasta" um número à toa: se a
 * transação inteira reverter, o incremento reverte junto.
 */
async function registrarDentroDaTransacao(tx, tenantId, usuario, ip, payload, caixaAberto, tenantParaChave) {
  if (tenantParaChave) {
    const { numero, chaveAcesso } = await reservarNumeroEChaveNfceNaTransacao(tx, tenantId, tenantParaChave, payload.venda.dataVenda || new Date());
    payload.venda.numeroNfce = numero;
    payload.venda.chaveNfce = chaveAcesso;
  }
  const criada = await tx.venda.create({ data: payload.venda });
  const itensData = payload.itens.map((item) => ({ ...item, vendaId: criada.id }));
  await tx.vendaItem.createMany({ data: itensData });
  await tx.vendaPagamento.createMany({ data: payload.pagamentos.map((p) => ({ ...p, vendaId: criada.id })) });

  for (const item of itensData) {
    // Mesmo tenantId já usado pra buscar este produto lá em cima, agora
    // aplicado nesta query (que já ia acontecer de qualquer forma) — sem
    // custo extra de round-trip, garante que o decremento de estoque
    // abaixo nunca mexe no EstoqueProduto de um produto de outro tenant.
    const produto = await tx.produto.findFirst({ where: { id: item.produtoId, tenantId } });
    if (!produto) throw new AppError('Produto não encontrado', 404);
    const qtd = Number(item.quantidade);
    // Fase 2b: produto com controlaLote consome FIFO (lote mais antigo
    // primeiro) e bloqueia se esbarrar em lote vencido — nunca decrementa
    // direto o agregado. Produto sem controlaLote: comportamento EXATO da
    // Fase 2a (decremento direto + permiteEstoqueNegativo).
    let ficouNegativo = false;
    let estoqueAnterior = null;
    if (produto.controlaLote) {
      // Rastreia de qual(is) lote(s) este item consumiu, pra devolver
      // certo se a venda for cancelada depois (ver cancelar() abaixo).
      const consumos = await loteService.consumirVendaFifo(tx, tenantId, produto, qtd);
      for (const consumo of consumos)
        await loteRepo.criarConsumo(tx, item.id, consumo.loteId, consumo.quantidade);
    } else {
      const resultado = await estoqueDepositoService.decrementarComRegra(tx, tenantId, produto.id, produto.nome, qtd);
      ficouNegativo = resultado.ficouNegativo;
      estoqueAnterior = resultado.estoqueAnterior;
    }
    await tx.movimentacaoEstoque.create({
      data: {
        tenantId,
        produtoId: produto.id,
        tipo: 'saida',
        quantidade: qtd,
        custoUnit: Number(item.custoUnitario || 0),
        origem: 'venda',
        origemId: criada.id,
        usuarioId: usuario.id,
      },
    });
    if (ficouNegativo) {
      await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'estoque_negativo', entidade: 'Produto', entidadeId: produto.id, depois: { estoque: estoqueAnterior, solicitado: qtd }, ip });
    }
  }

  await caixaRepo.atualizar(tx, tenantId, caixaAberto.id, {
    totalVendas: Number(caixaAberto.totalVendas) + Number(criada.total),
    totalDinheiro: Number(caixaAberto.totalDinheiro) + Number(payload.pagamentos.filter((p) => p.forma === 'dinheiro').reduce((s, p) => s + Number(p.valor), 0)),
    totalCartao: Number(caixaAberto.totalCartao) + Number(payload.pagamentos.filter((p) => p.forma === 'credito' || p.forma === 'debito').reduce((s, p) => s + Number(p.valor), 0)),
    totalPix: Number(caixaAberto.totalPix) + Number(payload.pagamentos.filter((p) => p.forma === 'pix').reduce((s, p) => s + Number(p.valor), 0)),
  });
  return criada;
}

/**
 * Cancela a venda — reverte estoque/caixa e, quando há NFC-e AUTORIZADA
 * (statusEmissaoFiscal='emitido', normal ou via contingência), também
 * cancela na SEFAZ (evento 110111) ANTES de mexer em qualquer coisa
 * operacional (ver nfceEmissao.service.resolverCancelamentoNfce). Decisão
 * confirmada com o usuário 2026-07-19, com pesquisa em fontes de mercado
 * sobre a regra de cancelamento de NFC-e (ver relatório da tarefa):
 *   - Se resolverCancelamentoNfce lançar (janela de 30min expirada, SEFAZ
 *     recusa, ou rede fora), a exceção propaga e a venda NÃO é cancelada —
 *     nem estoque nem caixa mudam, nada foi escrito ainda nesse ponto.
 *     Evita o estado "operacionalmente cancelada, mas ainda autorizada pra
 *     SEFAZ". Se isso acontecer de verdade (venda antiga, fora da janela),
 *     o caminho correto é uma Nota de Devolução separada — fora de escopo
 *     deste código.
 *   - NFC-e nunca autorizada (nao_aplicavel/pendente/falha_temporaria/
 *     rejeitado/contingencia_pendente_transmissao ainda não transmitida):
 *     nada a cancelar na SEFAZ — o evento seria rejeitado por falta de
 *     protocolo de autorização (confirmado via pesquisa: cancelamento
 *     exige nProtEvento). Só marca operacionalmente; os workers
 *     assíncronos (filaEmissaoNfce.buscarPendentes/
 *     filaTransmissaoContingencia.buscarPendentes) já filtram
 *     status≠'cancelada', então nunca mais tentam emitir/transmitir essa
 *     venda depois. numeroNfce/chaveNfce já reservados (se houver) ficam
 *     como buraco na sequência — Inutilização de Numeração formal (prazo
 *     legal: dia 10 do mês seguinte) é débito técnico documentado, NÃO
 *     implementado aqui (decisão explícita 2026-07-19, ver notas do
 *     projeto) — statusEmissaoFiscal fica intacto de propósito, pra uma
 *     futura rotina de inutilização conseguir encontrar exatamente estes
 *     casos (venda cancelada + numeroNfce preenchido + statusEmissaoFiscal
 *     em pendente/falha_temporaria).
 *
 * ATOMICIDADE (achado de revisão 2026-07-20, endereçado nesta sessão): a
 * chamada à SEFAZ (resolverCancelamentoNfce) roda ANTES e FORA de qualquer
 * transação — não dá pra segurar uma transação de banco esperando uma rede
 * externa. Mas TUDO que é escrita local (status/protocolo da venda, reversão
 * de caixa, reversão de estoque por item, movimentações) roda dentro de
 * UMA ÚNICA transação (executarTransacaoComRetry, mesmo helper de
 * registrar() — retry automático em lock_timeout/conexão transitória).
 * Antes desta mudança, cada um desses passos era uma escrita independente
 * sem nenhuma coordenação: uma queda de conexão no meio podia deixar a
 * venda cancelada na SEFAZ (ou operacionalmente) sem reverter estoque/caixa,
 * ou reverter só PARTE dos itens do carrinho. Agora, ou a reversão inteira
 * aplica, ou nenhuma parte dela aplica — sem estado intermediário visível.
 */
async function cancelar(tenantId, id, usuario, motivo, ip) {
  const venda = await vendaRepo.buscarPorId(tenantId, id);
  if (!venda) throw new AppError('Venda não encontrada', 404);
  if (venda.status === 'cancelada') throw new AppError('Venda já cancelada', 409);

  // Fora da transação, de propósito (ver "ATOMICIDADE" acima) — se lançar
  // (SEFAZ recusa, janela expirada), nada foi escrito ainda.
  const resolucaoFiscal = venda.statusEmissaoFiscal === 'emitido'
    ? await resolverCancelamentoNfce(tenantId, id, motivo)
    : null;

  await executarTransacaoComRetry(async (tx) => {
    if (resolucaoFiscal) {
      await aplicarCancelamentoNfce(tx, tenantId, id, resolucaoFiscal, usuario.id);
    } else {
      await vendaRepo.atualizarStatus(tenantId, id, { status: 'cancelada', canceladoEm: new Date(), canceladoPor: usuario.id, motivoCancelamento: motivo }, tx);
    }

    const caixaAberto = await caixaRepo.buscarAberto(tenantId, tx);
    if (caixaAberto) {
      await caixaRepo.atualizar(tx, tenantId, caixaAberto.id, { totalVendas: Math.max(0, Number(caixaAberto.totalVendas) - Number(venda.total)) });
    }
    for (const item of venda.itens) {
      const produto = await produtoRepo.buscarPorId(tenantId, item.produtoId, tx);
      const consumos = await loteRepo.listarConsumosPorItem(tx, item.id);
      if (consumos.length > 0) {
        // Devolve exatamente pro(s) lote(s) de origem — preserva a
        // invariante "EstoqueProduto.quantidade = soma dos Lote ativos".
        const estoqueProdutoIds = new Set();
        for (const consumo of consumos) {
          const lote = await loteRepo.devolverAoLote(tx, consumo.loteId, Number(consumo.quantidade));
          estoqueProdutoIds.add(lote.estoqueProdutoId);
        }
        for (const estoqueProdutoId of estoqueProdutoIds)
          await loteRepo.recalcularEstoqueProdutoDeLotes(tx, estoqueProdutoId, produto.id);
      } else {
        if (produto.controlaLote)
          logger.warn('Cancelamento de venda sem rastreio de lote — devolução aplicada só ao agregado', { tenantId, vendaId: id, vendaItemId: item.id, produtoId: produto.id });
        await estoqueDepositoRepo.ajustarEstoquePrincipal(tx, tenantId, produto.id, Number(item.quantidade));
      }
      await tx.movimentacaoEstoque.create({ data: { tenantId, produtoId: produto.id, tipo: 'devolucao', quantidade: Number(item.quantidade), custoUnit: Number(item.custoUnitario), origem: 'devolucao', origemId: venda.id, usuarioId: usuario.id } });
    }
  });

  if (resolucaoFiscal) {
    await auditoriaRepo.registrar({ tenantId, acao: 'cancelar_nfce', entidade: 'Venda', entidadeId: id, depois: { motivo: resolucaoFiscal.justificativaFinal } });
  }
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'cancelar', entidade: 'Venda', entidadeId: id, depois: { motivo }, ip });
  return { cancelada: true };
}

/** XML da NFC-e salvo na venda (Fase 1c complemento) — inclui rejeitadas, que também gravam o XML tentado. */
async function buscarXml(tenantId, id) {
  const venda = await vendaRepo.buscarXml(tenantId, id);
  if (!venda) throw new AppError('Venda não encontrada', 404);
  if (!venda.xmlNfce) throw new AppError('Esta venda não tem XML de NFC-e salvo — nunca foi emitida', 404);
  return { vendaId: venda.id, chaveNfce: venda.chaveNfce, xml: venda.xmlNfce };
}

/**
 * URL do QR Code (v2, via CSC) pra imprimir no DANFE — endpoint SEPARADO
 * de registrar() de propósito (fatia DANFE): montar a URL depende do CSC
 * (criptografado, precisa descriptografar) e pode falhar (ex: tenant com
 * ambienteFiscal=homologacao mas só CSC de produção configurado —
 * configuracaoFiscalCompleta não exige os dois, só o de produção). Um erro
 * aqui NUNCA pode derrubar a venda em si (já registrada com sucesso antes)
 * — por isso essa chamada é feita PELO PDV, depois que a venda já foi
 * criada, só pra imprimir; se falhar, o PDV decide imprimir sem QR Code.
 * Contingência (chave/QR v3 já vêm prontos do app ASSINATURA) não usa este
 * endpoint — o QR já está em mãos desde a venda.
 */
async function buscarQrCode(tenantId, id) {
  const venda = await vendaRepo.buscarParaQrCode(tenantId, id);
  if (!venda) throw new AppError('Venda não encontrada', 404);
  if (!venda.chaveNfce || !/^\d{44}$/.test(venda.chaveNfce))
    throw new AppError('Esta venda ainda não tem chave de acesso reservada', 422);

  const urls = resolverUrlsFiscais(venda.tenant.uf, venda.tenant.ambienteFiscal);
  const qrCodeUrl = montarUrlQrCode(venda.tenant, venda.chaveNfce, urls.qrcode);
  return { vendaId: venda.id, chaveNfce: venda.chaveNfce, qrCodeUrl };
}

async function sync(tenantId, vendas) {
  const resultados = [];
  for (const venda of vendas || []) {
    const existente = await vendaRepo.buscarPorIdLocal(tenantId, venda.localId);
    if (existente) { resultados.push({ localId: venda.localId, status: 'ok', mensagem: 'Ignorada por duplicidade' }); continue; }

    // ANTES do try/registrar abaixo e independente do resultado dele — ver
    // registrarNumeroContingenciaQueimado (por quê).
    if (venda.contingencia?.numeroQueimado != null) await registrarNumeroContingenciaQueimado(tenantId, venda);

    try {
      // Único caminho autorizado a informar dataVenda/contingência (venda
      // sincronizada depois do momento real em que aconteceu, possivelmente
      // já com NFC-e assinada em contingência off-line) — ver registrar().
      await registrar(tenantId, venda, { id: venda.operadorId || 'pdv' }, 'sync', { dataVenda: venda.dataVenda, contingencia: venda.contingencia });
      resultados.push({ localId: venda.localId, status: 'ok', mensagem: 'Sincronizada' });
    } catch (error) {
      resultados.push({ localId: venda.localId, status: 'erro', mensagem: error.message });
    }
  }
  return resultados;
}

/**
 * Grava em Auditoria o número/série da série de contingência que foi
 * reservado no app ASSINATURA da loja e NUNCA chegou a virar uma NFC-e
 * válida — assinar() falhou DEPOIS da reserva (rede, timeout; ver
 * vigia-pdv/.../services/vendaContingencia.js, catch interno de
 * tentarAssinarContingencia, que anexa numeroQueimado/serieQueimada ao
 * resultado só nesse caso específico).
 * Roda ANTES do try/registrar() em sync() e independente do resultado dele
 * de propósito: o número já foi queimado de verdade no contador local do
 * ASSINATURA (sem "desfazer" — ver contadorContingencia.js no repo
 * vigia-pdv-assinatura) no exato momento em que isso aconteceu no PDV: o
 * registro continua valendo mesmo que esta venda em si acabe rejeitada por
 * outro motivo (ex: produto não encontrado) — são dois fatos independentes.
 * Achado de revisão 2026-07-19/20: antes desta função existir, esse dado
 * chegava até aqui dentro de `venda.contingencia.motivo` (texto livre,
 * só usado para decidir 'erro'/'ok' de outros campos) e era descartado em
 * silêncio — nada persistia o número queimado, então a mensagem de erro já
 * enriquecida no PDV nunca chegava a virar um registro consultável. Usa a
 * tabela Auditoria (genérica, já existente, já usada para eventos deste
 * tipo neste mesmo arquivo — ver acao:'criar'/entidade:'Venda' logo acima)
 * em vez de uma tabela nova dedicada: não há Inutilização de Numeração
 * automática ainda (débito técnico documentado, decisão do usuário) — só
 * uma lista consultável para quando isso for feito manualmente.
 * Nunca lança: auditoriaRepo.registrar já engole os próprios erros
 * (loga e retorna null) — mesma filosofia "melhor esforço" do restante
 * desta fatia, ver header de vendaContingencia.js.
 */
async function registrarNumeroContingenciaQueimado(tenantId, venda) {
  const { numeroQueimado, serieQueimada, motivo } = venda.contingencia;
  await auditoriaRepo.registrar({
    tenantId,
    usuarioId: venda.operadorId || 'pdv',
    acao: 'numero_contingencia_queimado',
    entidade: 'ContingenciaNfce',
    depois: { numero: numeroQueimado, serie: serieQueimada, motivo, localId: venda.localId, dataVenda: venda.dataVenda },
    ip: 'sync',
  });
}

module.exports = { listar, detalhar, registrar, cancelar, sync, buscarXml, buscarQrCode, ehErroDeConexaoTransitoria, MAX_TENTATIVAS_TRANSACAO };