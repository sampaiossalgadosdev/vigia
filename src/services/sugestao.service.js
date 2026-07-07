/**
 * Arquivo: sugestao.service.js
 * Responsabilidade: Regra de negócio das sugestões recebidas pelo tenant
 * (listagem com contagem de pendentes e mudança de status lida/arquivada).
 * Utilizado por: SugestaoController.
 * Depende de: SugestaoRepository.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const sugestaoRepo = require('../repositories/sugestao.repository');
const { AppError, paginado } = require('../utils/response');

async function listar(tenantId, pag) {
  const { items, total, pendentes } = await sugestaoRepo.listarPorTenant(tenantId, pag);
  return { ...paginado(items, total, pag.page, pag.limit), pendentes };
}

async function mudarStatus(tenantId, id, status) {
  const sugestao = await sugestaoRepo.buscarPorId(id);
  if (!sugestao || sugestao.tenantId !== tenantId) throw new AppError('Sugestão não encontrada', 404);
  return sugestaoRepo.atualizarStatus(id, status);
}

module.exports = { listar, mudarStatus };
