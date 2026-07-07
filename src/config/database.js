/**
 * Arquivo: database.js
 * Responsabilidade: Fornecer a instância única (singleton) do PrismaClient.
 * Utilizado por: todos os repositories e middlewares de auth.
 * Nenhum outro arquivo deve instanciar PrismaClient.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
