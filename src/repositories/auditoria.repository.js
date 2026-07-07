/**
 * Arquivo: auditoria.repository.js
 * Responsabilidade: Único ponto de acesso ao Prisma para a entidade Auditoria.
 * Utilizado por: todos os services que registram eventos auditáveis.
 * Não contém regra de negócio. Falha de auditoria nunca derruba a operação principal.
 */
const prisma = require('../config/database');
const logger = require('../logs/logger');

/**
 * Registra um evento de auditoria. Erros são logados e engolidos de propósito.
 */
async function registrar({ tenantId = null, usuarioId = null, acao, entidade, entidadeId = null, antes = null, depois = null, ip = null }) {
  try {
    return await prisma.auditoria.create({
      data: { tenantId, usuarioId, acao, entidade, entidadeId, antes, depois, ip },
    });
  } catch (e) {
    logger.error('Falha ao registrar auditoria', { acao, entidade, erro: e.message });
    return null;
  }
}

module.exports = { registrar };
