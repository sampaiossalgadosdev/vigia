const caixaRepo = require('../repositories/caixa.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { AppError } = require('../utils/response');

async function atual(tenantId) {
  const caixa = await caixaRepo.buscarAberto(tenantId);
  return caixa || { status: 'fechado', mensagem: 'Nenhum caixa aberto' };
}

async function abrir(tenantId, body, usuario, ip) {
  const existente = await caixaRepo.buscarAberto(tenantId);
  if (existente) throw new AppError('Já existe um caixa aberto', 409);
  const caixa = await caixaRepo.abrir({ tenantId, operadorId: usuario.id, valorAbertura: Number(body.valorAbertura || 0) });
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'abrir', entidade: 'Caixa', entidadeId: caixa.id, depois: { valorAbertura: String(caixa.valorAbertura) }, ip });
  return caixa;
}

async function fechar(tenantId, body, usuario, ip) {
  const caixa = await caixaRepo.buscarAberto(tenantId);
  if (!caixa) throw new AppError('Nenhum caixa aberto', 404);
  const fechado = await caixaRepo.fechar(caixa.id, { status: 'fechado', valorFechamento: Number(body.valorFechamento || 0), diferenca: Number(body.valorFechamento || 0) - Number(caixa.totalVendas), fechadoEm: new Date(), observacao: body.observacao || null });
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'fechar', entidade: 'Caixa', entidadeId: caixa.id, depois: { valorFechamento: String(fechado.valorFechamento) }, ip });
  return fechado;
}

async function sangria(tenantId, body, usuario, ip) {
  const caixa = await caixaRepo.buscarAberto(tenantId);
  if (!caixa) throw new AppError('Nenhum caixa aberto', 404);
  const movimento = await caixaRepo.criarMovimentacao({ caixaId: caixa.id, tenantId, tipo: body.tipo || 'sangria', valor: Number(body.valor || 0), motivo: body.motivo || null, operadorId: usuario.id });
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'sangria', entidade: 'Caixa', entidadeId: caixa.id, depois: { valor: String(movimento.valor), tipo: movimento.tipo }, ip });
  return movimento;
}

async function historico(tenantId, query, pag) {
  const items = await caixaRepo.historico(tenantId, { skip: pag.skip, take: pag.limit });
  const total = await caixaRepo.contarHistorico(tenantId);
  return { items, total, page: pag.page, limit: pag.limit, totalPages: Math.ceil(total / pag.limit) };
}

module.exports = { atual, abrir, fechar, sangria, historico };