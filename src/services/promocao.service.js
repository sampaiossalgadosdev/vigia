const promocaoRepo = require('../repositories/promocao.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const pdvGateway = require('../ws/pdvGateway');
const { AppError, paginado } = require('../utils/response');

async function listar(tenantId, query) {
  const itens = await promocaoRepo.listar(tenantId, query);
  return { items: itens, total: itens.length };
}

async function detalhar(tenantId, id) {
  const promocao = await promocaoRepo.buscarPorId(tenantId, id);
  if (!promocao) throw new AppError('Promoção não encontrada', 404);
  return promocao;
}

async function criar(tenantId, body, usuario, ip) {
  const existente = await promocaoRepo.buscarAtivaPorProduto(tenantId, body.produtoId);
  if (existente) throw new AppError('Já existe uma promoção ativa para este produto', 409);
  const promocao = await promocaoRepo.criar({ tenantId, ...body, dataInicio: new Date(body.dataInicio), dataFim: new Date(body.dataFim) });
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'Promocao', entidadeId: promocao.id, depois: { nome: promocao.nome }, ip });
  pdvGateway.notificarSync(tenantId, 'promocoes');
  return promocao;
}

async function atualizar(tenantId, id, body, usuario, ip) {
  const atual = await detalhar(tenantId, id);
  const promocao = await promocaoRepo.atualizar(id, { ...body, dataInicio: new Date(body.dataInicio), dataFim: new Date(body.dataFim) });
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'editar', entidade: 'Promocao', entidadeId: id, antes: { nome: atual.nome }, depois: { nome: promocao.nome }, ip });
  pdvGateway.notificarSync(tenantId, 'promocoes');
  return promocao;
}

async function remover(tenantId, id, usuario, ip) {
  const atual = await detalhar(tenantId, id);
  const promocao = await promocaoRepo.encerrar(id);
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'excluir', entidade: 'Promocao', entidadeId: id, antes: { nome: atual.nome }, depois: { nome: promocao.nome }, ip });
  pdvGateway.notificarSync(tenantId, 'promocoes');
  return { encerrada: true, promocao };
}

async function vigentes(tenantId) {
  return promocaoRepo.vigentes(tenantId);
}

module.exports = { listar, detalhar, criar, atualizar, remover, vigentes };