/**
 * Arquivo: filaEmissaoNfce.service.js
 * Responsabilidade: Fila assíncrona de emissão de NFC-e (complemento Fase
 * 1c/3) — a venda nunca espera a SEFAZ pra fechar no PDV
 * (venda.service.registrar só marca Venda.statusEmissaoFiscal). Este
 * arquivo é o worker separado: processa em LOTE todas as vendas
 * pendentes/em retry de uma vez (não uma por vez, não a cada erro),
 * reaproveitando emitirNfce (nfceEmissao.service) pra cada uma.
 * `emitirNfce` NÃO tenta contingência SVC (decisão de fase posterior à
 * Fase 1c original — ver nota "SEM CONTINGÊNCIA SVC" em
 * nfceEmissao.service.js): falha de conexão vira `falha_temporaria` AQUI
 * mesmo (no catch abaixo), e é esta fila — não uma segunda tentativa
 * dentro de emitirNfce — quem tenta de novo o MESMO endpoint principal na
 * próxima passada, até a SEFAZ do estado voltar.
 * Também calcula a urgência de visibilidade do prazo legal de
 * contingência (Ajuste SINIEF 19/2016: final do 1º dia útil subsequente
 * à emissão) — só CÁLCULO, nenhuma ação automática de bloqueio/cancelamento.
 * Utilizado por: server.js (cron), FilaEmissaoController (endpoints manuais).
 * Depende de: NfceEmissaoService.
 */
const prisma = require('../config/database');
const { emitirNfce } = require('./nfceEmissao.service');
const { AppError } = require('../utils/response');

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const UMA_HORA_MS = 60 * 60 * 1000;

// Configuráveis via env — defaults conforme especificado.
const INTERVALO_RETRY_MINUTOS = Number(process.env.NFCE_RETRY_MINUTOS || 5);
const INTERVALO_PROCESSAMENTO_MINUTOS = Number(process.env.NFCE_PROCESSAMENTO_MINUTOS || 2);

/**
 * Vendas que o worker precisa tentar emitir agora: pendentes novas, ou em
 * retry cujo prazo já chegou. Ordenado por dataVenda (momento real da
 * venda), não criadoEm (momento do INSERT) — uma venda offline sincronizada
 * tarde deve furar a fila e ser processada antes de vendas mais recentes,
 * porque o prazo legal de contingência conta a partir da venda real, não
 * de quando ela chegou no banco.
 *
 * PROPOSITALMENTE SEM FILTRO DE tenantId — isto é global por design, não
 * um esquecimento. Únicos consumidores hoje: o cron de server.js (worker
 * de background, processa o sistema inteiro) e a rota de superadmin
 * GET/POST /api/superadmin/fila-emissao/* (protegida por authAdmin, uma
 * visão administrativa de TODOS os tenants, não de um tenant específico —
 * ver filaEmissao.controller.js). Se algum dia existir uma rota exposta a
 * um tenant específico (Dono, operador do PDV) que precise da fila/status
 * fiscal, ela DEVE usar uma função nova, filtrada por tenantId — nunca
 * reaproveitar esta função achando que já é segura.
 */
async function buscarPendentes() {
  const agora = new Date();
  return prisma.venda.findMany({
    where: {
      OR: [
        { statusEmissaoFiscal: 'pendente' },
        { statusEmissaoFiscal: 'falha_temporaria', proximaTentativaEm: { lte: agora } },
      ],
    },
    orderBy: { dataVenda: 'asc' },
  });
}

/**
 * Processa toda a fila numa passada, em SEQUÊNCIA (concorrência 1) — não
 * dispara N chamadas simultâneas contra a SEFAZ sem controle. Uma venda
 * falhando não impede as demais de serem processadas (cada resultado é
 * isolado num try/catch próprio).
 * `opcoesEmissao` repassa pra emitirNfce (ex: { chamarWebservice }) —
 * injetável só pra teste, mesmo padrão já usado em emitirNfce; em uso
 * normal nunca é passado (mock/real padrão escolhido sozinho).
 */
async function processarFilaEmissao(opcoesEmissao = {}) {
  const pendentes = await buscarPendentes();
  const resumo = { total: pendentes.length, emitidas: 0, rejeitadas: 0, falhaTemporaria: 0, erros: [] };

  for (const venda of pendentes) {
    try {
      await emitirNfce(venda.tenantId, venda.id, opcoesEmissao);
      await prisma.venda.update({
        where: { id: venda.id },
        data: { statusEmissaoFiscal: 'emitido', ultimaTentativaEm: new Date() },
      });
      resumo.emitidas++;
    } catch (erro) {
      // Rejeição de CONTEÚDO (SEFAZ respondeu recusando, cStat != 100):
      // não se resolve tentando de novo sem correção manual, então não
      // agenda retry. Qualquer outra falha (conexão/timeout esgotando
      // principal+SVC, ou erro inesperado) vira falha_temporaria — o
      // padrão seguro é sempre reagendar, nunca travar a venda numa
      // rejeição indevida por engano.
      const rejeicaoDeConteudo = erro instanceof AppError && erro.status === 422 && /rejeitada pela SEFAZ/.test(erro.message);

      if (rejeicaoDeConteudo) {
        await prisma.venda.update({
          where: { id: venda.id },
          data: { statusEmissaoFiscal: 'rejeitado', tentativasEmissao: { increment: 1 }, ultimaTentativaEm: new Date() },
        });
        resumo.rejeitadas++;
      } else {
        const proximaTentativaEm = new Date(Date.now() + INTERVALO_RETRY_MINUTOS * 60 * 1000);
        await prisma.venda.update({
          where: { id: venda.id },
          data: { statusEmissaoFiscal: 'falha_temporaria', tentativasEmissao: { increment: 1 }, ultimaTentativaEm: new Date(), proximaTentativaEm },
        });
        resumo.falhaTemporaria++;
      }
      resumo.erros.push({ vendaId: venda.id, mensagem: erro.message });
    }
  }
  return resumo;
}

function ehFimDeSemana(data) {
  const dia = data.getDay(); // 0 = domingo, 6 = sábado
  return dia === 0 || dia === 6;
}

/**
 * Final do 1º dia útil subsequente à data informada (Ajuste SINIEF
 * 19/2016 — prazo de contingência da NFC-e). LIMITAÇÃO CONHECIDA: não
 * considera feriados nacionais/estaduais/municipais nesta versão, só
 * sábado/domingo.
 */
function calcularPrazoLimiteContingencia(dataVenda) {
  const prazo = new Date(dataVenda);
  prazo.setDate(prazo.getDate() + 1);
  while (ehFimDeSemana(prazo)) prazo.setDate(prazo.getDate() + 1);
  prazo.setHours(23, 59, 59, 999);
  return prazo;
}

/**
 * Horas restantes até o prazo-limite de contingência e a categoria de
 * urgência — só visibilidade, nenhuma ação automática de bloqueio/cancelamento.
 * Recebe Venda.dataVenda (momento real da venda), não criadoEm (momento do
 * INSERT) — numa venda sincronizada depois via fluxo offline, os dois
 * divergem, e é o prazo real desde a venda que importa pra contingência.
 * `agora` é injetável (default = momento real) só pra permitir teste
 * determinístico da categorização por hora — em uso normal nunca é passado.
 */
function calcularUrgenciaEmissao(dataVenda, agora = new Date()) {
  const prazoLimite = calcularPrazoLimiteContingencia(dataVenda);
  const horasRestantes = (prazoLimite.getTime() - agora.getTime()) / UMA_HORA_MS;

  let urgencia;
  if (horasRestantes > 12) urgencia = 'tranquilo';
  else if (horasRestantes >= 4) urgencia = 'atencao';
  else urgencia = 'urgente';

  return { prazoLimite, horasRestantes, urgencia };
}

/**
 * Status da fila pra visibilidade administrativa: todas as vendas
 * pendentes/em falha temporária, cada uma com sua urgência calculada, e
 * um contador de "urgente" no topo (dado pronto pra um alerta visual
 * futuro — o alerta em si não é escopo desta função).
 *
 * PROPOSITALMENTE SEM FILTRO DE tenantId, mesma razão de buscarPendentes()
 * acima: único consumidor hoje é GET /api/superadmin/fila-emissao/status
 * (authAdmin, visão global de superadmin). Não reaproveitar para uma rota
 * de tenant sem adicionar o filtro.
 */
async function statusFila() {
  const vendas = await prisma.venda.findMany({
    where: { statusEmissaoFiscal: { in: ['pendente', 'falha_temporaria'] } },
    select: { id: true, tenantId: true, criadoEm: true, dataVenda: true, statusEmissaoFiscal: true, tentativasEmissao: true, proximaTentativaEm: true },
    orderBy: { dataVenda: 'asc' },
  });

  const itens = vendas.map((venda) => {
    const { prazoLimite, horasRestantes, urgencia } = calcularUrgenciaEmissao(venda.dataVenda);
    return { ...venda, prazoLimite, horasRestantes, urgencia };
  });

  return {
    totalUrgente: itens.filter((i) => i.urgencia === 'urgente').length,
    totalPendente: itens.filter((i) => i.statusEmissaoFiscal === 'pendente').length,
    totalFalhaTemporaria: itens.filter((i) => i.statusEmissaoFiscal === 'falha_temporaria').length,
    itens,
  };
}

module.exports = {
  processarFilaEmissao, calcularUrgenciaEmissao, calcularPrazoLimiteContingencia, statusFila,
  INTERVALO_RETRY_MINUTOS, INTERVALO_PROCESSAMENTO_MINUTOS,
};
