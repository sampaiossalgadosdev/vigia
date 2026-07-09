/**
 * Arquivo: server.js
 * Responsabilidade: Ponto de entrada da aplicação. Configura Express,
 * CORS, parsing, logging de requisições, arquivos estáticos, rotas da API,
 * 404 e o error handler central.
 * Fluxo: Request → Route → Middleware → Controller → Service → Repository → Prisma → Response
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const appConfig = require('./config/app');
const logger = require('./logs/logger');
const { error, AppError } = require('./utils/response');

const app = express();

app.use(cors(appConfig.cors));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Log de toda requisição (e de toda resposta com status >= 400)
app.use((req, res, next) => {
  const inicio = Date.now();
  res.on('finish', () => {
    const meta = {
      metodo: req.method, rota: req.originalUrl, status: res.statusCode,
      ms: Date.now() - inicio, ip: req.ip,
      usuario: req.usuario ? req.usuario.email : undefined,
    };
    if (res.statusCode >= 400) logger.warn('Resposta com erro', meta);
    else logger.info('Requisição', meta);
  });
  next();
});

// Rotas da API
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/produtos', require('./routes/produto.routes'));
app.use('/api/categorias', require('./routes/categoria.routes'));
app.use('/api/fornecedores', require('./routes/fornecedor.routes'));
app.use('/api/estoque', require('./routes/estoque.routes'));
app.use('/api/nfe-entrada', require('./routes/nfe-entrada.routes'));
app.use('/api/usuarios', require('./routes/usuario.routes'));
app.use('/api/perfis', require('./routes/perfil.routes'));
app.use('/api/sugestoes', require('./routes/sugestao.routes'));
app.use('/api/superadmin', require('./routes/superadmin.routes'));
app.use('/api/rede', require('./routes/rede.routes'));
app.use('/api/vendas', require('./routes/venda.routes'));
app.use('/api/promocoes', require('./routes/promocao.routes'));
app.use('/api/caixa', require('./routes/caixa.routes'));
app.use('/api/relatorios', require('./routes/relatorio.routes'));
app.use('/api/sync', require('./routes/sync.routes'));
app.use('/api/ia', require('./routes/ia.routes'));

// Healthcheck
app.get('/api/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }));

// Frontend estático
app.use(express.static(path.join(__dirname, '..', 'public')));

// 404 da API
app.use('/api', (req, res) => error(res, 'Rota não encontrada', [], 404));

// Error handler central
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof AppError) return error(res, err.message, err.errors, err.status);
  if (err && err.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo excede o limite de 10MB' : 'Falha no upload do arquivo';
    return error(res, msg, [], 422);
  }
  if (err && err.message && /Envie um arquivo/.test(err.message)) return error(res, err.message, [], 422);
  logger.error('Erro não tratado', { erro: err.message, stack: err.stack });
  return error(res, 'Erro interno do servidor', [], 500);
});

app.listen(appConfig.port, () => {
  logger.info(`VIGIA rodando em http://localhost:${appConfig.port} (${appConfig.env})`);
});
