/**
 * Arquivo: nfeDistribuicao.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para NfeDistribuicao
 * (resumos de NF-e recebidos da SEFAZ) e pro cursor Tenant.ultimoNsu.
 * Utilizado por: SefazService, NfeEntradaService.
 * Não contém regra de negócio.
 */
const prisma = require('../config/database');

async function buscarTenantComCertificado(tenantId) {
  return prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, cnpj: true, uf: true, ultimoNsu: true,
      certificadoPfx: true, certificadoSenha: true, certificadoUploadEm: true,
    },
  });
}

async function atualizarUltimoNsu(tenantId, ultimoNsu) {
  return prisma.tenant.update({ where: { id: tenantId }, data: { ultimoNsu } });
}

/**
 * Insere/atualiza um documento recebido da SEFAZ, chaveado por
 * (tenantId, chaveAcesso). Campos undefined não sobrescrevem o que já existe.
 */
async function upsertDocumento(tenantId, chaveAcesso, dados) {
  const limpos = {};
  for (const [k, v] of Object.entries(dados)) if (v !== undefined) limpos[k] = v;
  return prisma.nfeDistribuicao.upsert({
    where: { tenantId_chaveAcesso: { tenantId, chaveAcesso } },
    create: { tenantId, chaveAcesso, ...limpos },
    update: limpos,
  });
}

async function buscarPorChave(tenantId, chaveAcesso) {
  return prisma.nfeDistribuicao.findUnique({
    where: { tenantId_chaveAcesso: { tenantId, chaveAcesso } },
  });
}

async function atualizar(id, dados) {
  return prisma.nfeDistribuicao.update({ where: { id }, data: dados });
}

async function listar(tenantId, { dataInicio, dataFim, manifestacoes }) {
  const where = { tenantId };
  if (dataInicio || dataFim) {
    where.dataEmissao = {};
    if (dataInicio) where.dataEmissao.gte = dataInicio;
    if (dataFim) where.dataEmissao.lte = dataFim;
  }
  if (manifestacoes && manifestacoes.length) where.manifestacao = { in: manifestacoes };
  return prisma.nfeDistribuicao.findMany({
    where,
    orderBy: { dataEmissao: 'desc' },
    take: 500,
  });
}

module.exports = {
  buscarTenantComCertificado, atualizarUltimoNsu, upsertDocumento,
  buscarPorChave, atualizar, listar,
};
