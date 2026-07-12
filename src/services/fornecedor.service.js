/**
 * Arquivo: fornecedor.service.js
 * Responsabilidade: Centralizar toda regra de negócio de fornecedores:
 * CRUD com soft delete, documento (CNPJ pessoa jurídica / CPF pessoa física)
 * válido e único por tenant, representantes (replace-all na edição) e as
 * consultas de histórico de compras e produtos comprados (via Nfe/NfeItem).
 * Utilizado por: FornecedorController, EstoqueService.
 * Depende de: FornecedorRepository, AuditoriaRepository, utils/cnpj.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const fornecedorRepo = require('../repositories/fornecedor.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { limparCnpj } = require('../utils/cnpj');
const { AppError, paginado } = require('../utils/response');

// Campos opcionais aceitos no body (além de nome e cnpj). Os campos fin* são
// só captura para o futuro módulo financeiro — texto simples por enquanto.
const CAMPOS_OPCIONAIS = [
  'tipo', 'email', 'telefone', 'celular', 'observacao',
  'contribuinteIcms', 'regimeTributario',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
  'finCategoria', 'finTipoDocumento', 'finConta', 'finCentroCusto',
];

function normalizar(body) {
  const dados = {};
  if (body.nome) dados.nome = body.nome;
  for (const campo of CAMPOS_OPCIONAIS) if (body[campo] !== undefined) dados[campo] = body[campo] || null;
  if (dados.tipo === null) dados.tipo = 'pessoa_juridica'; // tipo tem default, nunca fica null
  if (dados.uf) dados.uf = String(dados.uf).toUpperCase();
  return dados;
}

/** Sanitiza a lista de representantes; undefined = não mexer neles. */
function normalizarRepresentantes(lista) {
  if (!Array.isArray(lista)) return undefined;
  return lista
    .filter((r) => r && String(r.nome || '').trim())
    .map((r) => ({
      nome: String(r.nome).trim(),
      email: r.email || null, telefone: r.telefone || null, celular: r.celular || null,
    }));
}

async function listar(tenantId, query, pag) {
  const { items, total } = await fornecedorRepo.listar(tenantId, query, pag);
  return paginado(items, total, pag.page, pag.limit);
}

async function detalhar(tenantId, id) {
  const fornecedor = await fornecedorRepo.buscarPorId(tenantId, id);
  if (!fornecedor) throw new AppError('Fornecedor não encontrado', 404);
  return fornecedor;
}

async function criar(tenantId, body, usuario, ip) {
  const cnpj = limparCnpj(body.cnpj);
  const existente = await fornecedorRepo.buscarPorCnpj(tenantId, cnpj);
  if (existente) throw new AppError('Já existe um fornecedor com este CNPJ/CPF neste supermercado', 409);

  const representantes = normalizarRepresentantes(body.representantes);
  const fornecedor = await fornecedorRepo.criar({
    tenantId, cnpj, ...normalizar(body),
    ...(representantes && representantes.length ? { representantes: { create: representantes } } : {}),
  });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'Fornecedor',
    entidadeId: fornecedor.id, depois: { nome: fornecedor.nome, cnpj: fornecedor.cnpj }, ip,
  });
  return fornecedor;
}

async function atualizar(tenantId, id, body, usuario, ip) {
  const atual = await detalhar(tenantId, id);
  const dados = normalizar(body);
  if (body.cnpj) {
    const cnpj = limparCnpj(body.cnpj);
    if (cnpj !== atual.cnpj) {
      const existente = await fornecedorRepo.buscarPorCnpj(tenantId, cnpj);
      if (existente && existente.id !== id)
        throw new AppError('Já existe um fornecedor com este CNPJ/CPF neste supermercado', 409);
    }
    dados.cnpj = cnpj;
  }
  const fornecedor = await fornecedorRepo.atualizar(tenantId, id, dados);

  const representantes = normalizarRepresentantes(body.representantes);
  if (representantes !== undefined) await fornecedorRepo.substituirRepresentantes(id, representantes);

  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'editar', entidade: 'Fornecedor', entidadeId: id,
    antes: { nome: atual.nome, cnpj: atual.cnpj }, depois: { nome: fornecedor.nome, cnpj: fornecedor.cnpj }, ip,
  });
  return detalhar(tenantId, id);
}

async function remover(tenantId, id, usuario, ip) {
  const atual = await detalhar(tenantId, id);
  await fornecedorRepo.atualizar(tenantId, id, { ativo: false });
  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'excluir', entidade: 'Fornecedor',
    entidadeId: id, antes: { nome: atual.nome }, ip,
  });
  return { removido: true };
}

/** Aba Histórico de Compras: NF-e do fornecedor, mais recentes primeiro. */
async function compras(tenantId, id, pag) {
  await detalhar(tenantId, id);
  const { items, total } = await fornecedorRepo.listarCompras(tenantId, id, pag);
  const linhas = items.map((n) => ({
    id: n.id,
    dataEmissao: n.dataEmissao,
    numeroNfe: n.numeroNfe,
    status: n.status,
    qtdeItens: n._count.itens,
    valorTotal: Number(n.valorTotal),
  }));
  return paginado(linhas, total, pag.page, pag.limit);
}

/**
 * Aba Produtos: todo produto que já entrou por NF-e desse fornecedor, com os
 * dados da ÚLTIMA compra (custo unitário daquela compra, não o custo médio;
 * valor total do item = quantidade × custo unitário dessa última compra).
 */
async function produtos(tenantId, id) {
  await detalhar(tenantId, id);
  const itens = await fornecedorRepo.listarItensComprados(tenantId, id);
  const porProduto = new Map();
  for (const item of itens) {
    if (porProduto.has(item.produtoId)) continue; // já veio de uma compra mais recente
    const quantidade = Number(item.quantidade);
    const custoUnitario = Number(item.valorUnitario);
    porProduto.set(item.produtoId, {
      produtoId: item.produtoId,
      codigoReferencia: item.produto.codigoReferencia,
      nome: item.produto.nome,
      ultimaCompra: item.nfe.dataEmissao,
      quantidade,
      custoUnitario,
      valorTotalItem: Math.round(quantidade * custoUnitario * 100) / 100,
    });
  }
  const items = [...porProduto.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { items, total: items.length };
}

module.exports = { listar, detalhar, criar, atualizar, remover, compras, produtos };
