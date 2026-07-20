const prisma = require('../config/database');

async function listar(tenantId, filtros, { skip, take }) {
  const where = { tenantId };
  if (filtros.status) where.status = filtros.status;
  if (filtros.operadorId) where.operadorId = filtros.operadorId;
  if (filtros.inicio || filtros.fim) {
    where.dataVenda = {};
    if (filtros.inicio) where.dataVenda.gte = new Date(filtros.inicio);
    if (filtros.fim) where.dataVenda.lte = new Date(filtros.fim);
  }
  const [items, total] = await Promise.all([
    prisma.venda.findMany({
      where,
      skip,
      take,
      orderBy: { dataVenda: 'desc' },
      include: { pagamentos: true, itens: { include: { produto: { select: { id: true, nome: true, ean: true } } } } },
    }),
    prisma.venda.count({ where }),
  ]);
  return { items, total };
}

async function buscarPorId(tenantId, id) {
  return prisma.venda.findFirst({
    where: { id, tenantId },
    include: {
      itens: { include: { produto: { select: { id: true, nome: true, ean: true, unidade: true } }, promocao: true } },
      pagamentos: true,
    },
  });
}

async function criarVendaTransacao(payload) {
  return prisma.$transaction(async (tx) => {
    const venda = await tx.venda.create({ data: payload.venda });
    const itens = payload.itens.map((item) => ({ ...item, vendaId: venda.id }));
    await tx.vendaItem.createMany({ data: itens });
    await tx.vendaPagamento.createMany({ data: payload.pagamentos.map((p) => ({ ...p, vendaId: venda.id })) });
    return venda;
  });
}

/** `tx` opcional (default o client singleton) — achado de revisão 2026-07-20: venda.service.cancelar() precisa gravar o status dentro da MESMA transação que reverte estoque/caixa (atomicidade completa). Chamadores existentes (nfceEmissao.service.emitirNfce/cancelarNfce, nfceContingenciaTransmissao.service) continuam iguais, sem passar o 4º argumento. */
async function atualizarStatus(tenantId, id, dados, tx = prisma) {
  return tx.venda.update({ where: { id, tenantId }, data: dados });
}

/**
 * Venda com os campos de produto necessários pra montar o XML da NFC-e
 * (NCM, CFOP, código de referência) — buscarPorId não traz esses campos
 * porque é usado pelas telas de detalhe/listagem, que não precisam deles.
 */
async function buscarParaEmissao(tenantId, id) {
  return prisma.venda.findFirst({
    where: { id, tenantId },
    include: {
      itens: { include: { produto: { select: { id: true, nome: true, codigoReferencia: true, ncm: true, cfop: true, unidade: true, cstIbsCbs: true, cClassTrib: true } } } },
      pagamentos: true,
    },
  });
}

/** Só o essencial pra consulta do XML salvo (Fase 1c complemento) — evita trazer itens/pagamentos à toa. */
async function buscarXml(tenantId, id) {
  return prisma.venda.findFirst({ where: { id, tenantId }, select: { id: true, xmlNfce: true, chaveNfce: true } });
}

/**
 * Só o essencial pra montar a URL do QR Code (fatia DANFE) — chaveNfce da
 * venda + os campos do tenant que montarUrlQrCode precisa (uf, ambiente,
 * CSC ainda criptografado). Nunca traz certificadoPfx/certificadoSenha.
 */
async function buscarParaQrCode(tenantId, id) {
  return prisma.venda.findFirst({
    where: { id, tenantId },
    select: {
      id: true, chaveNfce: true,
      tenant: { select: { uf: true, ambienteFiscal: true, cscProducao: true, cscProducaoId: true, cscHomologacao: true, cscHomologacaoId: true } },
    },
  });
}

async function buscarPorIdLocal(tenantId, idLocal) {
  return prisma.venda.findFirst({ where: { tenantId, localId: idLocal } });
}

async function listarResumoDiario(tenantId, inicio, fim) {
  const where = { tenantId, dataVenda: { gte: inicio, lte: fim }, status: 'concluida' };
  return prisma.venda.findMany({ where, orderBy: { dataVenda: 'asc' }, include: { pagamentos: true } });
}

module.exports = { listar, buscarPorId, criarVendaTransacao, atualizarStatus, buscarPorIdLocal, listarResumoDiario, buscarParaEmissao, buscarXml, buscarParaQrCode };