/**
 * Arquivo: dashboard.service.js
 * Responsabilidade: Regra de negócio do dashboard principal: cálculo dos
 * períodos de referência a partir da data selecionada (mês: dia 01 até a
 * data; ano: 01/01 até a data, ambos no fuso da loja), médias diluídas e
 * montagem das séries de cada widget.
 * Utilizado por: DashboardController.
 * Depende de: DashboardRepository, luxon.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const { DateTime } = require('luxon');
const repo = require('../repositories/dashboard.repository');
const { AppError } = require('../utils/response');

const TZ = 'America/Sao_Paulo';

/**
 * Interpreta ?data=YYYY-MM-DD no fuso da loja e devolve os dois períodos de
 * referência e os dias decorridos de cada um. Sem parâmetro, usa hoje.
 */
function periodos(dataParam) {
  const dt = dataParam
    ? DateTime.fromISO(String(dataParam), { zone: TZ })
    : DateTime.now().setZone(TZ);
  if (!dt.isValid) throw new AppError('Parâmetro data inválido — use o formato AAAA-MM-DD', 422);

  const fim = dt.endOf('day');
  return {
    dataRef: dt,
    mes: { inicio: dt.startOf('month').toJSDate(), fim: fim.toJSDate(), dias: dt.day },
    ano: { inicio: dt.startOf('year').toJSDate(), fim: fim.toJSDate(), dias: dt.ordinal },
    dia: { inicio: dt.startOf('day').toJSDate(), fim: fim.toJSDate() },
  };
}

async function resumo(tenantId, dataParam) {
  const { mes } = periodos(dataParam);
  const { total, vendas } = await repo.resumoVendas(tenantId, mes.inicio, mes.fim);
  return {
    totalVendas: total,
    mediaDiariaVendas: total / mes.dias,
    clientesAtendidos: vendas, // 1 venda concluída = 1 atendimento (sem cadastro de cliente)
    mediaDiariaClientes: vendas / mes.dias,
    ticketMedio: vendas > 0 ? total / vendas : 0,
    diasDecorridos: mes.dias,
  };
}

async function gruposProdutos(tenantId, dataParam) {
  const { mes } = periodos(dataParam);
  const grupos = await repo.vendasPorGrupo(tenantId, mes.inicio, mes.fim);
  const total = grupos.reduce((acc, g) => acc + g.valor, 0);
  return grupos.map((g) => ({
    grupo: g.grupo,
    valor: g.valor,
    percentual: total > 0 ? (g.valor / total) * 100 : 0,
  }));
}

async function formasPagamento(tenantId, dataParam) {
  const { mes } = periodos(dataParam);
  const formas = await repo.vendasPorFormaPagamento(tenantId, mes.inicio, mes.fim);
  const total = formas.reduce((acc, f) => acc + f.valor, 0);
  return formas.map((f) => ({
    forma: f.forma,
    valor: f.valor,
    percentual: total > 0 ? (f.valor / total) * 100 : 0,
  }));
}

async function topProdutos(tenantId, dataParam) {
  const { mes } = periodos(dataParam);
  return repo.topProdutos(tenantId, mes.inicio, mes.fim);
}

async function topVendedores(tenantId, dataParam) {
  const { mes } = periodos(dataParam);
  return repo.topVendedores(tenantId, mes.inicio, mes.fim);
}

/** Série completa do dia 01 até o dia selecionado (dias sem venda zerados). */
async function vendasDiarias(tenantId, dataParam) {
  const { mes, dataRef } = periodos(dataParam);
  const porDia = await repo.vendasPorDia(tenantId, mes.inicio, mes.fim);
  const mapa = new Map(porDia.map((d) => [d.dia, d]));
  return Array.from({ length: dataRef.day }, (_, i) => {
    const d = mapa.get(i + 1);
    return { dia: i + 1, valor: d ? d.valor : 0, clientes: d ? d.vendas : 0 };
  });
}

/** Série de janeiro até o mês selecionado (meses sem venda zerados). */
async function vendasMensais(tenantId, dataParam) {
  const { ano, dataRef } = periodos(dataParam);
  const porMes = await repo.vendasPorMes(tenantId, ano.inicio, ano.fim);
  const mapa = new Map(porMes.map((m) => [m.mes, m]));
  return Array.from({ length: dataRef.month }, (_, i) => {
    const m = mapa.get(i + 1);
    return { mes: i + 1, valor: m ? m.valor : 0, vendas: m ? m.vendas : 0 };
  });
}

/**
 * Quantas vezes cada dia da semana (0=domingo…6=sábado) ocorre no calendário
 * entre 01/01 e a data selecionada — denominador da média semanal.
 */
function ocorrenciasPorDow(dataRef) {
  const ocorrencias = [0, 0, 0, 0, 0, 0, 0];
  for (let d = dataRef.startOf('year'); d <= dataRef; d = d.plus({ days: 1 }))
    ocorrencias[d.weekday % 7] += 1; // luxon: weekday 1=segunda…7=domingo
  return ocorrencias;
}

/**
 * Média por dia da semana sobre todas as ocorrências do dia no calendário do
 * ano de referência. Só dias com alguma venda entram (eixo dinâmico).
 */
async function vendaMediaSemanal(tenantId, dataParam) {
  const { ano, dataRef } = periodos(dataParam);
  const porDow = await repo.vendasPorDiaSemana(tenantId, ano.inicio, ano.fim);
  const ocorrencias = ocorrenciasPorDow(dataRef);
  // Segunda→sábado→domingo, como nos ERPs de referência.
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const mapa = new Map(porDow.map((d) => [d.dow, d]));
  return ordem
    .filter((dow) => mapa.has(dow))
    .map((dow) => {
      const d = mapa.get(dow);
      const n = ocorrencias[dow] || 1;
      return { dow, valorMedio: d.valor / n, clientesMedio: d.vendas / n };
    });
}

/**
 * Por hora: média diluída do ano (soma ÷ TODOS os dias decorridos do ano,
 * regra confirmada com o usuário) + o realizado do dia selecionado.
 * Faixa de horas dinâmica: da menor à maior hora com venda, contínua.
 */
async function vendasPorHora(tenantId, dataParam) {
  const { ano, dia } = periodos(dataParam);
  const [anoPorHora, diaPorHora] = await Promise.all([
    repo.vendasPorHora(tenantId, ano.inicio, ano.fim),
    repo.vendasPorHora(tenantId, dia.inicio, dia.fim),
  ]);
  const horasComVenda = [...anoPorHora, ...diaPorHora].map((h) => h.hora);
  if (!horasComVenda.length) return [];

  const mapaAno = new Map(anoPorHora.map((h) => [h.hora, h]));
  const mapaDia = new Map(diaPorHora.map((h) => [h.hora, h]));
  const minimo = Math.min(...horasComVenda);
  const maximo = Math.max(...horasComVenda);

  const linhas = [];
  for (let hora = minimo; hora <= maximo; hora += 1) {
    const a = mapaAno.get(hora);
    const d = mapaDia.get(hora);
    linhas.push({
      hora,
      valorMediaAno: a ? a.valor / ano.dias : 0,
      clientesMediaAno: a ? a.vendas / ano.dias : 0,
      valorDia: d ? d.valor : 0,
    });
  }
  return linhas;
}

module.exports = {
  resumo, gruposProdutos, formasPagamento, topProdutos, topVendedores,
  vendasDiarias, vendasMensais, vendaMediaSemanal, vendasPorHora,
};
