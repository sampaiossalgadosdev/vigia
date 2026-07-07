/**
 * Arquivo: logger.js
 * Responsabilidade: Instância única do winston com dois transportes:
 * console legível (desenvolvimento) e arquivo JSON logs/app.log (produção).
 * Utilizado por: server.js, middlewares e services que precisam registrar eventos.
 */
const winston = require('winston');
const path = require('path');
const appConfig = require('../config/app');

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
        return `[${timestamp}] ${level}: ${message}${extra}`;
      })
    ),
  }),
];

if (appConfig.isProducao) {
  transports.push(
    new winston.transports.File({
      filename: path.join(__dirname, 'app.log'),
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    })
  );
}

const logger = winston.createLogger({
  level: appConfig.isProducao ? 'info' : 'debug',
  transports,
});

module.exports = logger;
