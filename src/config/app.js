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
const origensConfiguradas = valorCorsOrigin.split(',').map((o) => o.trim()).filter(Boolean);
const permiteQualquerOrigem = !valorCorsOrigin || origensConfiguradas.includes('*');

// Origens do PDV (Electron, projeto vigia-pdv) sempre liberadas, mesmo
// quando CORS_ORIGIN em produção está restrito a outro domínio (ex.: o
// painel web). Em dev o PDV roda em http://localhost:5173 (porta padrão
// do Vite). Empacotado, ele carrega a UI via file:// e o Chromium do
// Electron manda o header Origin ausente ou como a string literal "null"
// — nenhum dos dois casos bate com um domínio comum na allowlist, então
// precisam ser tratados explicitamente aqui.
const origensSempreLiberadas = ['http://localhost:5173', 'file://', 'null'];

function origemPermitida(origin) {
  if (permiteQualquerOrigem) return true;
  // Sem header Origin (ex.: file:// em algumas versões do Electron, ou
  // chamada same-origin) não é requisição cross-origin pro navegador —
  // o cors nem chegaria a bloquear isso, então não há por que negar.
  if (!origin) return true;
  if (origensSempreLiberadas.includes(origin)) return true;
  return origensConfiguradas.includes(origin);
}

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'development',
  isProducao: (process.env.NODE_ENV || 'development') === 'production',
  cors: {
    origin(origin, callback) {
      callback(null, origemPermitida(origin));
    },
    credentials: true,
  },
};
