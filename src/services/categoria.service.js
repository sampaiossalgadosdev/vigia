/**
 * Arquivo: categoria.service.js
 * Responsabilidade: Regra de negócio da hierarquia de categorias
 * (grupo pai → subgrupo, máximo 2 níveis), soft delete com bloqueios,
 * listagem de produtos do subgrupo e aplicação de markup em lote.
 * Utilizado por: CategoriaController.
 * Depende de: CategoriaRepository, AuditoriaRepository.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const categoriaRepo = require('../repositories/categoria.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { AppError, paginado } = require('../utils/response');

async function listarArvore(tenantId) {
  return categoriaRepo.listarArvore(tenantId);
}

async function detalhar(tenantId, id) {
  const categoria = await categoriaRepo.buscarPorId(tenantId, id);
  if (!categoria || !categoria.ativo) throw new AppError('Categoria não encontrada', 404);
  return categoria;
}

/**
 * Garante que o pai informado pode receber filhos: existe no tenant,
 * está ativo e é um grupo raiz (2 níveis no máximo).
 */
async function validarPai(tenantId, parentId) {
  const pai = await categoriaRepo.buscarPorId(tenantId, parentId);
  if (!pai || !pai.ativo) throw new AppError('Grupo superior não encontrado neste supermercado', 422);
  if (pai.parentId) throw new AppError('Subgrupo não pode ter filhos — a hierarquia tem no máximo 2 níveis', 422);
  return pai;
}

function normalizarMarkup(valor) {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  return Number(valor);
}

async function criar(tenantId, body, usuario, ip) {
  const nome = body.nome.trim();
  const existente = await categoriaRepo.buscarPorNome(tenantId, nome);
  if (existente && existente.ativo)
    throw new AppError('Já existe uma categoria com este nome neste supermercado', 409);

  if (body.parentId) await validarPai(tenantId, body.parentId);

  // Nome soft-deletado é reaproveitado (reativa) pra não esbarrar no
  // unique(tenantId, nome) com um registro que o usuário nem vê.
  const dados = {
    nome,
    markupPercent: normalizarMarkup(body.markupPercent) ?? null,
    parentId: body.parentId || null,
  };
  const categoria = existente
    ? await categoriaRepo.atualizar(existente.id, { ...dados, ativo: true })
    : await categoriaRepo.criar({ ...dados, tenantId });

  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'Categoria',
    entidadeId: categoria.id, depois: { nome: categoria.nome, parentId: categoria.parentId }, ip,
  });
  return categoria;
}

async function atualizar(tenantId, id, body, usuario, ip) {
  const atual = await detalhar(tenantId, id);
  const dados = {};

  if (body.nome !== undefined) {
    const nome = body.nome.trim();
    if (nome !== atual.nome) {
      const existente = await categoriaRepo.buscarPorNome(tenantId, nome);
      if (existente && existente.ativo && existente.id !== id)
        throw new AppError('Já existe uma categoria com este nome neste supermercado', 409);
    }
    dados.nome = nome;
  }

  const markup = normalizarMarkup(body.markupPercent);
  if (markup !== undefined) dados.markupPercent = markup;

  if (body.parentId !== undefined && (body.parentId || null) !== atual.parentId) {
    const novoPai = body.parentId || null;
    if (novoPai) {
      if (novoPai === id) throw new AppError('Uma categoria não pode ser filha de si mesma', 422);
      const filhos = await categoriaRepo.contarFilhosAtivos(tenantId, id);
      if (filhos > 0)
        throw new AppError('Este grupo tem subgrupos vinculados — mova os subgrupos antes de transformá-lo em subgrupo', 422);
      await validarPai(tenantId, novoPai);
    }
    dados.parentId = novoPai;
  }

  const categoria = await categoriaRepo.atualizar(id, dados);
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'editar', entidade: 'Categoria', entidadeId: id,
    antes: { nome: atual.nome, markupPercent: atual.markupPercent, parentId: atual.parentId },
    depois: { nome: categoria.nome, markupPercent: categoria.markupPercent, parentId: categoria.parentId }, ip,
  });
  return categoria;
}

/**
 * Soft delete. Bloqueia se ainda houver subgrupos ativos ou produtos
 * ativos vinculados — o usuário precisa mover/excluir os filhos antes.
 */
async function remover(tenantId, id, usuario, ip) {
  const atual = await detalhar(tenantId, id);

  const filhos = await categoriaRepo.contarFilhosAtivos(tenantId, id);
  if (filhos > 0)
    throw new AppError('Este grupo ainda tem ' + filhos + ' subgrupo(s) ativo(s) — mova ou exclua os subgrupos primeiro', 422);

  const produtos = await categoriaRepo.contarProdutosAtivos(tenantId, id);
  if (produtos > 0)
    throw new AppError('Esta categoria ainda tem ' + produtos + ' produto(s) vinculado(s) — mova os produtos pra outra categoria primeiro', 422);

  await categoriaRepo.atualizar(id, { ativo: false });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'excluir', entidade: 'Categoria',
    entidadeId: id, antes: { nome: atual.nome, parentId: atual.parentId }, ip,
  });
  return { removido: true };
}

async function listarProdutos(tenantId, id, pag) {
  await detalhar(tenantId, id);
  const { items, total } = await categoriaRepo.listarProdutos(tenantId, id, pag);
  return paginado(items, total, pag.page, pag.limit);
}

/**
 * Recalcula o preço de venda dos produtos do escopo pelo markup salvo na
 * categoria: novoPreco = custoMedio * (1 + markupPercent/100), 2 casas.
 * Grupo pai: aplica nos produtos dos subgrupos filhos (e nos vinculados
 * diretamente ao grupo, caso de dados anteriores à hierarquia).
 * Subgrupo: só nos produtos diretamente vinculados.
 * Produtos sem custo médio (<= 0) são pulados — não há base de cálculo.
 */
async function aplicarMarkup(tenantId, id, usuario, ip) {
  const categoria = await detalhar(tenantId, id);
  const markup = categoria.markupPercent === null ? null : Number(categoria.markupPercent);
  if (markup === null)
    throw new AppError('Defina e salve o markup da categoria antes de aplicar', 422);

  const escopo = [id];
  if (!categoria.parentId) escopo.push(...await categoriaRepo.idsSubgruposAtivos(tenantId, id));

  const produtos = await categoriaRepo.produtosParaMarkup(tenantId, escopo);
  const fator = 1 + markup / 100;
  const atualizacoes = produtos
    .filter((p) => Number(p.custoMedio) > 0)
    .map((p) => ({ id: p.id, preco: Math.round(Number(p.custoMedio) * fator * 100) / 100 }));

  if (atualizacoes.length > 0) await categoriaRepo.aplicarPrecos(atualizacoes);

  const pulados = produtos.length - atualizacoes.length;
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'aplicar_markup', entidade: 'Categoria',
    entidadeId: id,
    depois: { markupPercent: String(markup), produtosAfetados: atualizacoes.length, produtosPulados: pulados }, ip,
  });

  return { aplicados: atualizacoes.length, pulados, markupPercent: markup };
}

module.exports = { listarArvore, detalhar, criar, atualizar, remover, listarProdutos, aplicarMarkup };
