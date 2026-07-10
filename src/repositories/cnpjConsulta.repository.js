/**
 * Arquivo: cnpjConsulta.repository.js
 * Responsabilidade: Acesso ao cache de consultas de CNPJ (CnpjConsultaCache).
 * O cache é global (não é por tenant): dado público da Receita Federal.
 * Utilizado por: cnpjConsulta.service.
 */
const prisma = require('../config/database');

async function buscar(cnpj) {
  return prisma.cnpjConsultaCache.findUnique({ where: { cnpj } });
}

async function salvar(cnpj, resposta) {
  return prisma.cnpjConsultaCache.upsert({
    where: { cnpj },
    create: { cnpj, resposta },
    update: { resposta, consultadoEm: new Date() },
  });
}

module.exports = { buscar, salvar };
