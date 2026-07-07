/**
 * Arquivo: produto.service.js
 * Responsabilidade: Centralizar toda regra de negócio de produtos
 * (CRUD com soft delete, EAN único por tenant, PLU por peso, sync PDV,
 * alertas de estoque e auditoria).
 * Utilizado por: ProdutoController.
 * Depende de: ProdutoRepository, AuditoriaRepository.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const produtoRepo = require('../repositories/produto.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { AppError, paginado } = require('../utils/response');

/**
 * Converte o body validado em dados prontos para persistência.
 */
function normalizar(body) {
  const dados = {};
  const campos = ['ean', 'nome', 'marca', 'ncm', 'unidade', 'plu', 'codigoInterno', 'imagemUrl', 'categoriaId'];
  for (const campo of campos) if (body[campo] !== undefined) dados[campo] = body[campo] || null;
  if (dados.nome === null) delete dados.nome;
  if (dados.ean === null) delete dados.ean;
  if (dados.unidade === null) dados.unidade = 'UN';
  for (const campo of ['preco', 'custoMedio', 'estoqueQtd', 'estoqueMin'])
    if (body[campo] !== undefined && body[campo] !== null && body[campo] !== '') dados[campo] = Number(body[campo]);
  if (body.vendidoPorPeso !== undefined)
    dados.vendidoPorPeso = body.vendidoPorPeso === true || body.vendidoPorPeso === 'true';
  if (dados.vendidoPorPeso === false) dados.plu = null;
  return dados;
}

/**
 * Busca todos os produtos do tenant com paginação e filtros.
 */
async function listar(tenantId, query, pag) {
  const { items, total } = await produtoRepo.listar(tenantId, query, pag);
  return paginado(items, total, pag.page, pag.limit);
}

async function detalhar(tenantId, id) {
  const produto = await produtoRepo.buscarPorId(tenantId, id);
  if (!produto) throw new AppError('Produto não encontrado', 404);
  return produto;
}

async function criar(tenantId, body, usuario, ip) {
  const dados = normalizar(body);
  if (dados.vendidoPorPeso && !dados.plu)
    throw new AppError('PLU é obrigatório para produtos vendidos por peso', 422);

  const existente = await produtoRepo.buscarPorEan(tenantId, dados.ean);
  if (existente) throw new AppError('Já existe um produto com este EAN neste supermercado', 409);

  if (dados.categoriaId) {
    const categoria = await produtoRepo.buscarCategoria(tenantId, dados.categoriaId);
    if (!categoria) throw new AppError('Categoria não encontrada neste supermercado', 422);
  }

  const produto = await produtoRepo.criar({ ...dados, tenantId });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'Produto',
    entidadeId: produto.id, depois: { nome: produto.nome, ean: produto.ean, preco: String(produto.preco) }, ip,
  });
  return produto;
}

async function atualizar(tenantId, id, body, usuario, ip) {
  const atual = await detalhar(tenantId, id);
  const dados = normalizar(body);

  if (dados.ean && dados.ean !== atual.ean) {
    const existente = await produtoRepo.buscarPorEan(tenantId, dados.ean);
    if (existente && existente.id !== id)
      throw new AppError('Já existe um produto com este EAN neste supermercado', 409);
  }
  if (dados.categoriaId) {
    const categoria = await produtoRepo.buscarCategoria(tenantId, dados.categoriaId);
    if (!categoria) throw new AppError('Categoria não encontrada neste supermercado', 422);
  }
  const vendidoPorPeso = dados.vendidoPorPeso ?? atual.vendidoPorPeso;
  if (vendidoPorPeso && !(dados.plu ?? atual.plu))
    throw new AppError('PLU é obrigatório para produtos vendidos por peso', 422);

  const produto = await produtoRepo.atualizar(id, dados);

  const precoMudou = dados.preco !== undefined && Number(atual.preco) !== dados.preco;
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id,
    acao: precoMudou ? 'alterar_preco' : 'editar',
    entidade: 'Produto', entidadeId: id,
    antes: { nome: atual.nome, preco: String(atual.preco) },
    depois: { nome: produto.nome, preco: String(produto.preco) }, ip,
  });
  return produto;
}

/**
 * Soft delete: marca ativo = false. Nunca remove fisicamente.
 */
async function remover(tenantId, id, usuario, ip) {
  const atual = await detalhar(tenantId, id);
  await produtoRepo.atualizar(id, { ativo: false });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'excluir', entidade: 'Produto',
    entidadeId: id, antes: { nome: atual.nome, ean: atual.ean }, ip,
  });
  return { removido: true };
}

/**
 * Sync incremental para o PDV (?desde=ISO_DATE).
 */
async function sync(tenantId, desde) {
  let data = null;
  if (desde) {
    data = new Date(desde);
    if (Number.isNaN(data.getTime())) throw new AppError('Parâmetro desde deve ser uma data ISO válida', 422);
  }
  const produtos = await produtoRepo.sync(tenantId, data);
  return { produtos, sincronizadoEm: new Date().toISOString() };
}

async function alertas(tenantId) {
  const itens = await produtoRepo.alertasEstoque(tenantId);
  return {
    total: itens.length,
    negativos: itens.filter((p) => Number(p.estoqueQtd) < 0).length,
    itens,
  };
}

module.exports = { listar, detalhar, criar, atualizar, remover, sync, alertas };
