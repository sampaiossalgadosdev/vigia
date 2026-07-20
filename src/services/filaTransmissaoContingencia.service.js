/**
 * Arquivo: filaTransmissaoContingencia.service.js
 * Responsabilidade: Fila assíncrona de transmissão de NFC-e de contingência
 * off-line (tpEmis=9) já assinadas — complemento do fluxo iniciado em
 * vigia-pdv (venda cai offline → app ASSINATURA assina localmente → sync
 * chega no backend já com XML pronto, ver venda.service.registrar e
 * nfceContingenciaTransmissao.service.js). Espelha a estrutura de
 * filaEmissaoNfce.service.js (fila do fluxo normal), mas processa um
 * status DIFERENTE e chama uma função DIFERENTE — nunca compartilha
 * vendas com aquela fila (ver nota "SEM CONTINGÊNCIA SVC" e a nota sobre
 * `opcoes.contingencia` em venda.service.registrar: uma venda com XML já
 * assinado em contingência NUNCA recebe statusEmissaoFiscal='pendente',
 * então filaEmissaoNfce.buscarPendentes nunca a pega).
 * Utilizado por: server.js (cron).
 * Depende de: nfceContingenciaTransmissao.service.
 */
const prisma = require('../config/database');
const { transmitirContingencia } = require('./nfceContingenciaTransmissao.service');
const { AppError } = require('../utils/response');

const STATUS_PENDENTE = 'contingencia_pendente_transmissao';

// Configuráveis via env — mesmos defaults de filaEmissaoNfce.service.js.
const INTERVALO_RETRY_MINUTOS = Number(process.env.NFCE_CONTINGENCIA_RETRY_MINUTOS || 5);
const INTERVALO_PROCESSAMENTO_MINUTOS = Number(process.env.NFCE_CONTINGENCIA_PROCESSAMENTO_MINUTOS || 2);

/**
 * Vendas com XML de contingência assinado aguardando transmissão à SEFAZ:
 * pendentes novas, ou em retry cujo prazo já chegou. Ordenado por
 * dataVenda (momento real da venda — pode ter sido sincronizada bem depois
 * do momento real, mesmo raciocínio de filaEmissaoNfce.buscarPendentes),
 * já que o prazo legal de regularização da contingência (24h — SEFAZ-PR,
 * RICMS/PR Anexo IX Art. 10 §15-16) conta a partir da venda real.
 *
 * `status: { not: 'cancelada' }` — mesmo achado de revisão 2026-07-19 de
 * filaEmissaoNfce.buscarPendentes: sem isso, cancelar uma venda ainda
 * 'contingencia_pendente_transmissao' (venda.service.cancelar) não
 * impedia este worker de transmitir o XML já assinado depois, autorizando
 * uma NFC-e pra uma venda que não existe mais.
 */
async function buscarPendentes() {
  const agora = new Date();
  return prisma.venda.findMany({
    where: {
      status: { not: 'cancelada' },
      OR: [
        { statusEmissaoFiscal: STATUS_PENDENTE, proximaTentativaEm: null },
        { statusEmissaoFiscal: STATUS_PENDENTE, proximaTentativaEm: { lte: agora } },
      ],
    },
    orderBy: { dataVenda: 'asc' },
  });
}

/**
 * Processa toda a fila numa passada, em SEQUÊNCIA (concorrência 1) — mesma
 * decisão de filaEmissaoNfce.processarFilaEmissao. `opcoesTransmissao`
 * repassa pra transmitirContingencia (ex: { chamarWebservice}) — injetável
 * só pra teste.
 */
async function processarFilaTransmissaoContingencia(opcoesTransmissao = {}) {
  const pendentes = await buscarPendentes();
  const resumo = { total: pendentes.length, transmitidas: 0, rejeitadas: 0, falhaTemporaria: 0, erros: [] };

  for (const venda of pendentes) {
    try {
      await transmitirContingencia(venda.tenantId, venda.id, opcoesTransmissao);
      resumo.transmitidas++;
    } catch (erro) {
      // Mesma classificação de filaEmissaoNfce.processarFilaEmissao:
      // rejeição de CONTEÚDO não se resolve tentando de novo sem correção
      // manual; qualquer outra falha (conexão/timeout) reagenda retry.
      const rejeicaoDeConteudo = erro instanceof AppError && erro.status === 422 && /rejeitada pela SEFAZ/.test(erro.message);

      // A atualização de status vai num try/catch PRÓPRIO: entre
      // buscarPendentes() e este ponto, a venda pode ter sido removida (ou
      // alterada) por fora do lote (ex: cancelamento manual concorrente —
      // buscarPendentes é global, sem filtro de tenant, por design, mesmo
      // padrão de filaEmissaoNfce.service). Se isso acontecer, P2025
      // ("record not found") não pode derrubar o lote inteiro — só esta
      // venda fica sem registro de tentativa, as demais seguem normalmente.
      try {
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
            data: { statusEmissaoFiscal: STATUS_PENDENTE, tentativasEmissao: { increment: 1 }, ultimaTentativaEm: new Date(), proximaTentativaEm },
          });
          resumo.falhaTemporaria++;
        }
      } catch (erroAoRegistrar) {
        if (erroAoRegistrar.code !== 'P2025') throw erroAoRegistrar;
      }
      resumo.erros.push({ vendaId: venda.id, mensagem: erro.message });
    }
  }
  return resumo;
}

module.exports = {
  processarFilaTransmissaoContingencia, buscarPendentes,
  STATUS_PENDENTE, INTERVALO_RETRY_MINUTOS, INTERVALO_PROCESSAMENTO_MINUTOS,
};
