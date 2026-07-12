/**
 * Arquivo: filaEmissaoNfce.service.js
 * Responsabilidade: Fila assíncrona de emissão de NFC-e (complemento Fase
 * 1c/3) — a venda nunca espera a SEFAZ pra fechar no PDV
 * (venda.service.registrar só marca Venda.statusEmissaoFiscal). Este
 * arquivo é o worker separado: processa em LOTE todas as vendas
 * pendentes/em retry de uma vez (não uma por vez, não a cada erro),
 * reaproveitando emitirNfce (nfceEmissao.service, com a contingência
 * principal→SVC já existente da Fase 1c) pra cada uma.
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

/** Vendas que o worker precisa tentar emitir agora: pendentes novas, ou em retry cujo prazo já chegou. */
async function buscarPendentes() {
  const agora = new Date();
  return prisma.venda.findMany({
    where: {
      OR: [
        { statusEmissaoFiscal: 'pendente' },
        { statusEmissaoFiscal: 'falha_temporaria', proximaTentativaEm: { lte: agora } },
      ],
    },
    orderBy: { criadoEm: 'asc' },
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
function calcularPrazoLimiteContingencia(dataEmissaoVenda) {
  const prazo = new Date(dataEmissaoVenda);
  prazo.setDate(prazo.getDate() + 1);
  while (ehFimDeSemana(prazo)) prazo.setDate(prazo.getDate() + 1);
  prazo.setHours(23, 59, 59, 999);
  return prazo;
}

/**
 * Horas restantes até o prazo-limite de contingência e a categoria de
 * urgência — só visibilidade, nenhuma ação automática de bloqueio/cancelamento.
 * `agora` é injetável (default = momento real) só pra permitir teste
 * determinístico da categorização por hora — em uso normal nunca é passado.
 */
function calcularUrgenciaEmissao(dataEmissaoVenda, agora = new Date()) {
  const prazoLimite = calcularPrazoLimiteContingencia(dataEmissaoVenda);
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
 */
async function statusFila() {
  const vendas = await prisma.venda.findMany({
    where: { statusEmissaoFiscal: { in: ['pendente', 'falha_temporaria'] } },
    select: { id: true, tenantId: true, criadoEm: true, statusEmissaoFiscal: true, tentativasEmissao: true, proximaTentativaEm: true },
    orderBy: { criadoEm: 'asc' },
  });

  const itens = vendas.map((venda) => {
    const { prazoLimite, horasRestantes, urgencia } = calcularUrgenciaEmissao(venda.criadoEm);
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
