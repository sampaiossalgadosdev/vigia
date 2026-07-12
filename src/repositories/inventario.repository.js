/**
 * Arquivo: inventario.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para Inventario e
 * InventarioItem (Fase 2c). Só operações mecânicas — a regra de negócio
 * (snapshot no início, ajuste automático no fechamento) fica em
 * inventario.service.js.
 * Utilizado por: InventarioService.
 */
const prisma = require('../config/database');

async function criar(tenantId, depositoId, tipo, categoriaFiltro, iniciadoPorId, itens) {
  return prisma.inventario.create({
    data: {
      tenantId, depositoId, tipo, categoriaFiltro: categoriaFiltro || null, iniciadoPorId,
      itens: { create: itens },
    },
    include: { itens: true },
  });
}

async function buscarPorId(tenantId, id) {
  return prisma.inventario.findFirst({
    where: { id, tenantId },
    include: { itens: true, deposito: { select: { id: true, nome: true } } },
  });
}

async function buscarItem(inventarioId, produtoId) {
  return prisma.inventarioItem.findFirst({ where: { inventarioId, produtoId } });
}

async function registrarContagem(itemId, quantidadeContada, usuarioId) {
  return prisma.inventarioItem.update({
    where: { id: itemId },
    data: { quantidadeContada, contadoPorId: usuarioId, contadoEm: new Date() },
  });
}

async function fechar(tenantId, id) {
  return prisma.inventario.update({ where: { id, tenantId }, data: { status: 'fechado', finalizadoEm: new Date() } });
}

module.exports = { criar, buscarPorId, buscarItem, registrarContagem, fechar };
