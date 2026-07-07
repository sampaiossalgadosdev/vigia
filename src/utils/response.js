/**
 * Arquivo: response.js
 * Responsabilidade: Helpers padronizados de resposta da API (success/error),
 * classe AppError para erros de negócio, asyncHandler e helper de paginação.
 * Utilizado por: controllers, middlewares, server.js.
 * Não realiza acesso HTTP externo nem acesso ao Prisma.
 */

const success = (res, data, status = 200) => res.status(status).json({ success: true, data });

const error = (res, message, errors = [], status = 400) =>
  res.status(status).json({ success: false, message, errors });

/**
 * Erro de negócio com status HTTP. Lançado pelos services e tratado
 * pelo error handler central do server.js.
 */
class AppError extends Error {
  constructor(message, status = 400, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Envolve um controller async para encaminhar exceções ao error handler central.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Monta o objeto padrão de listagem paginada.
 */
const paginado = (items, total, page, limit) => ({
  items,
  total,
  page,
  limit,
  totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
});

/**
 * Normaliza os parâmetros de paginação vindos da query string.
 */
const lerPaginacao = (query) => {
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '20', 10) || 20, 1), 100);
  const order = query.order === 'desc' ? 'desc' : 'asc';
  const search = (query.search || '').trim();
  return { page, limit, order, search, skip: (page - 1) * limit };
};

module.exports = { success, error, AppError, asyncHandler, paginado, lerPaginacao };
