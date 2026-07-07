/**
 * Arquivo: bcrypt.js
 * Responsabilidade: Funções puras de hash e comparação de senhas com bcrypt.
 * Utilizado por: services de auth, usuário, superadmin e rede.
 */
const bcrypt = require('bcryptjs');
const authConfig = require('../config/auth');

/**
 * Gera o hash bcrypt de um valor em texto puro.
 */
async function gerarHash(valor) {
  return bcrypt.hash(valor, authConfig.bcryptRounds);
}

/**
 * Compara um valor em texto puro com um hash bcrypt.
 */
async function comparar(valor, hash) {
  return bcrypt.compare(valor, hash);
}

module.exports = { gerarHash, comparar };
