/**
 * Arquivo: estoque.service.js
 * Responsabilidade: Regra de negócio de entrada de NF-e (upload/parse do XML,
 * casamento de itens por EAN, confirmação transacional com custo médio
 * ponderado), vinculação de itens pendentes e histórico de movimentações.
 * Utilizado por: EstoqueController.
 * Depende de: EstoqueRepository, ProdutoRepository, FornecedorRepository,
 * AuditoriaRepository, utils/nfe.parser, utils/cnpj.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const estoqueRepo = require('../repositories/estoque.repository');
const produtoRepo = require('../repositories/produto.repository');
const fornecedorRepo = require('../repositories/fornecedor.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const loteService = require('../services/lote.service');
const ajusteEstoqueService = require('../services/ajusteEstoque.service');
const transferenciaService = require('../services/transferencia.service');
const transformacaoService = require('../services/transformacao.service');
const { parseNfe } = require('../utils/nfe.parser');
const { validarCnpj } = require('../utils/cnpj');
const { AppError, paginado } = require('../utils/response');

/**
 * Recebe o XML da NF-e, parseia, casa itens por EAN e persiste a nota
 * com status pendente. Itens sem produto correspondente ficam pendentes.
 */
async function uploadNfe(tenantId, buffer, usuario, ip) {
  if (!buffer) throw new AppError('Envie o arquivo XML da NF-e', 422);

  let nota;
  try {
    nota = parseNfe(buffer.toString('utf8'));
  } catch (e) {
    throw new AppError(e.message, 422);
  }

  const existente = await estoqueRepo.buscarNfePorChave(nota.chaveAcesso);
  if (existente) throw new AppError('Esta NF-e já foi importada (chave de acesso duplicada)', 409);

  // Fornecedor: casa por CNPJ do emitente; cria automaticamente se não existir
  let fornecedorId = null;
  if (validarCnpj(nota.emitente.cnpj)) {
    let fornecedor = await fornecedorRepo.buscarPorCnpj(tenantId, nota.emitente.cnpj);
    if (!fornecedor) {
      fornecedor = await fornecedorRepo.criar({
        tenantId, nome: nota.emitente.nome, cnpj: nota.emitente.cnpj,
        telefone: nota.emitente.telefone,
      });
      await auditoriaRepo.registrar({
        tenantId, usuarioId: usuario.id, acao: 'criar', entidade: 'Fornecedor',
        entidadeId: fornecedor.id, depois: { nome: fornecedor.nome, cnpj: fornecedor.cnpj, origem: 'nfe' }, ip,
      });
    }
    fornecedorId = fornecedor.id;
  }

  // Casa itens por EAN dentro do tenant
  const eans = nota.itens.map((i) => i.ean).filter(Boolean);
  const produtos = eans.length ? await produtoRepo.buscarPorEans(tenantId, eans) : [];
  const porEan = new Map(produtos.map((p) => [p.ean, p]));

  const itens = nota.itens.map((item) => {
    const produto = item.ean ? porEan.get(item.ean) : null;
    return {
      produtoId: produto ? produto.id : null,
      ean: item.ean || item.codigoFornecedor || 'SEM-GTIN',
      descricao: item.descricao,
      ncm: item.ncm,
      unidade: item.unidade,
      quantidade: item.quantidade,
      valorUnitario: item.valorUnitario,
      valorTotal: item.valorTotal,
      status: produto ? 'ok' : 'pendente',
    };
  });

  const nfe = await estoqueRepo.criarNfe(
    {
      tenantId, fornecedorId,
      chaveAcesso: nota.chaveAcesso, numeroNfe: nota.numeroNfe,
      dataEmissao: nota.dataEmissao, valorTotal: nota.valorTotal,
      xmlOriginal: buffer.toString('utf8'),
    },
    itens
  );

  return {
    ...nfe,
    resumo: {
      totalItens: itens.length,
      itensOk: itens.filter((i) => i.status === 'ok').length,
      itensPendentes: itens.filter((i) => i.status === 'pendente').length,
    },
  };
}

/**
 * Confirma a entrada da NF-e em transação: atualiza estoque e custo médio
 * ponderado dos itens ok e cria as movimentações. Itens pendentes são ignorados
 * (confirmação parcial permitida).
 * `lotesPorItem` ({ [nfeItemId]: { numeroLote, dataValidade } }) é exigido
 * pra todo item aplicável cujo produto tenha controlaLote=true — sem isso a
 * confirmação inteira é bloqueada ANTES de abrir a transação (nenhum item é
 * aplicado parcialmente).
 */
async function confirmarNfe(tenantId, nfeId, usuario, ip, lotesPorItem = {}) {
  const nfe = await estoqueRepo.buscarNfePorId(tenantId, nfeId);
  if (!nfe) throw new AppError('NF-e não encontrada', 404);
  if (nfe.status === 'confirmada') throw new AppError('Esta NF-e já foi confirmada', 409);
  if (nfe.status === 'cancelada') throw new AppError('Esta NF-e está cancelada', 409);

  const aplicaveis = nfe.itens.filter((i) => i.status === 'ok' && i.produtoId);
  for (const item of aplicaveis) {
    if (item.produto.controlaLote && !lotesPorItem[item.id]?.dataValidade)
      throw new AppError(`Produto ${item.produto.nome} controla lote/validade — informe a validade do lote antes de confirmar`, 422);
  }
  const confirmada = await estoqueRepo.confirmarNfeTransacao(nfe, aplicaveis, usuario.id, lotesPorItem);

  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'confirmar', entidade: 'Nfe', entidadeId: nfeId,
    depois: {
      chaveAcesso: nfe.chaveAcesso,
      itensAplicados: aplicaveis.length,
      itensPendentesIgnorados: nfe.itens.length - aplicaveis.length,
    },
    ip,
  });
  return confirmada;
}

/**
 * Vincula um item pendente de NF-e a um produto existente do tenant.
 * Se a NF-e já estiver confirmada, aplica a entrada do item na mesma
 * transação — nesse caso, se o produto controla lote/validade, `loteInfo`
 * ({ numeroLote, dataValidade }) é exigido antes de vincular.
 */
async function vincularItem(tenantId, nfeId, itemId, produtoId, usuario, ip, loteInfo) {
  const nfe = await estoqueRepo.buscarNfePorId(tenantId, nfeId);
  if (!nfe) throw new AppError('NF-e não encontrada', 404);
  const item = await estoqueRepo.buscarItemNfe(nfeId, itemId);
  if (!item) throw new AppError('Item da NF-e não encontrado', 404);
  if (item.status !== 'pendente') throw new AppError('Este item não está pendente', 409);

  const produto = await produtoRepo.buscarPorId(tenantId, produtoId);
  if (!produto || !produto.ativo) throw new AppError('Produto não encontrado neste supermercado', 404);

  const aplicarEntrada = nfe.status === 'confirmada';
  if (aplicarEntrada && produto.controlaLote && !loteInfo?.dataValidade)
    throw new AppError(`Produto ${produto.nome} controla lote/validade — informe a validade do lote antes de vincular`, 422);
  const atualizado = await estoqueRepo.vincularItemTransacao(nfe, item, produtoId, usuario.id, aplicarEntrada, undefined, loteInfo);

  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'editar', entidade: 'Nfe', entidadeId: nfeId,
    depois: { itemVinculado: item.descricao, produto: produto.nome, entradaAplicada: aplicarEntrada }, ip,
  });
  return atualizado;
}

async function listarNfes(tenantId, query, pag) {
  const { items, total } = await estoqueRepo.listarNfes(tenantId, query, pag);
  return paginado(items, total, pag.page, pag.limit);
}

async function detalharNfe(tenantId, id) {
  const nfe = await estoqueRepo.buscarNfePorId(tenantId, id);
  if (!nfe) throw new AppError('NF-e não encontrada', 404);
  return nfe;
}

async function listarMovimentacoes(tenantId, query, pag) {
  const { items, total } = await estoqueRepo.listarMovimentacoes(tenantId, query, pag);
  return paginado(items, total, pag.page, pag.limit);
}

async function listarPendentes(tenantId) {
  const itens = await estoqueRepo.listarItensPendentes(tenantId);
  return { total: itens.length, itens };
}

/** Lotes ativos vencidos/vencendo dentro de `dias` (default 7), agrupados por urgência (Fase 2b). */
async function alertasValidade(tenantId, dias) {
  return loteService.alertasValidade(tenantId, dias);
}

/** Gera promoção relâmpago automática para lotes vencendo dentro de `dias` (default 5) sem promoção ativa (Fase 2b). */
async function gerarPromocoesRelampago(tenantId, usuario, ip, dias) {
  return loteService.gerarPromocoesRelampago(tenantId, usuario, ip, dias);
}

/** Ajuste de estoque manual auditável (Fase 2c) — ver ajusteEstoque.service.js. */
async function ajustarEstoque(tenantId, usuarioId, produtoId, depositoId, novaQuantidade, motivo, loteId) {
  return ajusteEstoqueService.ajusteEstoque(tenantId, usuarioId, produtoId, depositoId, novaQuantidade, motivo, loteId);
}

/** Transferência de estoque entre depósitos (Fase 2d) — ver transferencia.service.js. */
async function transferirEstoque(tenantId, usuarioId, produtoId, depositoOrigemId, depositoDestinoId, quantidade, motivo, loteId) {
  return transferenciaService.transferirEstoque(tenantId, usuarioId, produtoId, depositoOrigemId, depositoDestinoId, quantidade, motivo, loteId);
}

/** Transformação de produto (Fase 2d) — ver transformacao.service.js. */
async function transformarProduto(tenantId, usuarioId, produtoOrigemId, produtoDestinoId, depositoId, quantidadeOrigemConsumida, quantidadeDestinoGerada, motivo, loteOrigemId, dataValidadeDestino) {
  return transformacaoService.transformarProduto(tenantId, usuarioId, produtoOrigemId, produtoDestinoId, depositoId, quantidadeOrigemConsumida, quantidadeDestinoGerada, motivo, loteOrigemId, dataValidadeDestino);
}

module.exports = {
  uploadNfe, confirmarNfe, vincularItem, listarNfes, detalharNfe,
  listarMovimentacoes, listarPendentes, alertasValidade, gerarPromocoesRelampago, ajustarEstoque,
  transferirEstoque, transformarProduto,
};
