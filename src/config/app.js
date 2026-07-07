/**
 * Arquivo: app.js
 * Responsabilidade: Centralizar configurações gerais da aplicação (porta, ambiente, CORS).
 * Utilizado por: server.js e demais módulos que precisam de configuração de app.
 * Único ponto (junto com config/auth.js) autorizado a ler process.env.
 */
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'development',
  isProducao: (process.env.NODE_ENV || 'development') === 'production',
  cors: {
    origin: true,
    credentials: false,
  },
};
