/**
 * Arquivo: app.js
 * Responsabilidade: Centralizar configurações gerais da aplicação (porta, ambiente, CORS).
 * Utilizado por: server.js e demais módulos que precisam de configuração de app.
 * Único ponto (junto com config/auth.js) autorizado a ler process.env.
 */
require('dotenv').config();

// CORS_ORIGIN: domínio(s) do frontend autorizados a chamar a API entre
// origens (um único valor, ou vários separados por vírgula; "*" libera
// qualquer origem — como já era o padrão, e como o README já documentava
// antes deste arquivo de fato ler a variável). Requisições same-origin (o
// próprio public/ servido por este mesmo processo Express, caso do deploy
// atual) nunca passam pelo CORS do navegador, então não precisam estar
// aqui — isso só importa se outro domínio/app consumir a API via fetch do
// navegador. Sem a variável configurada, mantém o comportamento permissivo
// anterior (reflete qualquer origem), pra não quebrar produção em silêncio.
const valorCorsOrigin = (process.env.CORS_ORIGIN || '').trim();
const origensPermitidas = valorCorsOrigin.split(',').map((o) => o.trim()).filter(Boolean);

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'development',
  isProducao: (process.env.NODE_ENV || 'development') === 'production',
  cors: {
    origin: !valorCorsOrigin || origensPermitidas.includes('*') ? true : origensPermitidas,
    credentials: false,
  },
};
