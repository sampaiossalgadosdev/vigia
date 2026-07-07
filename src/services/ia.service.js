const prisma = require('../config/database');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { AppError } = require('../utils/response');

async function gerarSugestoes(tenantId, usuario, ip) {
  const decisoes = await prisma.decisaoIA.findMany({ where: { tenantId }, orderBy: { criadoEm: 'desc' }, take: 50 });
  const produtos = await prisma.produto.findMany({ where: { tenantId, ativo: true }, orderBy: { updatedAt: 'desc' }, take: 20 });
  const texto = `Historico: ${decisoes.map((d) => d.tipo + ':' + d.valorDepois).join(' | ')}. Produtos: ${produtos.map((p) => `${p.nome}:${p.estoqueQtd}`).join(' | ')}`;
  const resposta = `Sugestão simulada para ${tenantId}: ${texto}`;
  if (produtos[0]) {
    await prisma.decisaoIA.create({ data: { tenantId, produtoId: produtos[0].id, tipo: 'promocao_criada', valorDepois: 0, estoqueNaMomento: 0, giro30dias: 0 } });
  }
  await auditoriaRepo.registrar({ tenantId, usuarioId: usuario.id, acao: 'gerar', entidade: 'DecisaoIA', depois: { resposta }, ip });
  return { sugestoes: [{ produto: produtos[0]?.nome || 'Produto', desconto: 10, justificativa: resposta }], historico: [{ resposta }] };
}

async function historico(tenantId) {
  return prisma.decisaoIA.findMany({ where: { tenantId }, orderBy: { criadoEm: 'desc' }, take: 20 });
}

module.exports = { gerarSugestoes, historico };