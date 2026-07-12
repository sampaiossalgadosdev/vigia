/**
 * Arquivo: inventario.service.js
 * Responsabilidade: Regra de negócio de inventário (Fase 2c) — abre uma
 * contagem física (geral: todo o depósito; parcial: uma categoria),
 * registra a contagem item a item, e reconcilia no fechamento: produto sem
 * lote diverge → ajuste automático (AjusteEstoqueService); produto com
 * lote diverge → não ajusta sozinho (não dá pra saber de qual lote veio a
 * diferença só olhando o agregado), entra na lista de revisão manual.
 * Utilizado por: InventarioController.
 * Depende de: InventarioRepository, EstoqueDepositoRepository,
 * ProdutoRepository, AjusteEstoqueService.
 */
const inventarioRepo = require('../repositories/inventario.repository');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const produtoRepo = require('../repositories/produto.repository');
const ajusteEstoqueService = require('./ajusteEstoque.service');
const { AppError } = require('../utils/response');

const TIPOS_VALIDOS = ['geral', 'parcial'];

async function iniciarInventario(tenantId, usuarioId, depositoId, tipo, categoriaFiltro) {
  if (!TIPOS_VALIDOS.includes(tipo))
    throw new AppError('tipo deve ser "geral" ou "parcial"', 422);
  if (tipo === 'parcial' && !categoriaFiltro)
    throw new AppError('Informe categoriaFiltro para inventário parcial', 422);

  const deposito = await estoqueDepositoRepo.buscarPorId(tenantId, depositoId);
  if (!deposito) throw new AppError('Depósito não encontrado neste supermercado', 404);

  const estoques = await estoqueDepositoRepo.listarEstoquePorDeposito(depositoId, tipo === 'parcial' ? categoriaFiltro : undefined);
  const itens = estoques.map((e) => ({ produtoId: e.produtoId, quantidadeSistema: e.quantidade }));

  return inventarioRepo.criar(tenantId, depositoId, tipo, categoriaFiltro, usuarioId, itens);
}

/**
 * Detalhe do inventário com os itens enriquecidos com nome/EAN do produto —
 * InventarioItem só guarda produtoId (sem relation), então o join é feito
 * aqui, não no Prisma include.
 */
async function detalhar(tenantId, id) {
  const inventario = await inventarioRepo.buscarPorId(tenantId, id);
  if (!inventario) throw new AppError('Inventário não encontrado', 404);
  if (inventario.itens.length === 0) return inventario;

  const produtos = await produtoRepo.listarPorIds(tenantId, inventario.itens.map((i) => i.produtoId));
  const mapaProdutos = new Map(produtos.map((p) => [p.id, p]));
  return {
    ...inventario,
    itens: inventario.itens.map((item) => ({
      ...item,
      produtoNome: mapaProdutos.get(item.produtoId)?.nome || null,
      produtoEan: mapaProdutos.get(item.produtoId)?.ean || null,
    })),
  };
}

async function registrarContagem(tenantId, inventarioId, produtoId, quantidadeContada, usuarioId) {
  const inventario = await detalhar(tenantId, inventarioId);
  if (inventario.status !== 'aberto') throw new AppError('Inventário já foi fechado', 409);

  const item = await inventarioRepo.buscarItem(inventarioId, produtoId);
  if (!item) throw new AppError('Este produto não faz parte deste inventário', 404);

  return inventarioRepo.registrarContagem(item.id, Number(quantidadeContada), usuarioId);
}

async function fecharInventario(tenantId, id, usuario, ip) {
  const inventario = await detalhar(tenantId, id);
  if (inventario.status !== 'aberto') throw new AppError('Inventário já foi fechado', 409);

  const contados = inventario.itens.filter((i) => i.quantidadeContada !== null);
  const produtos = await produtoRepo.listarPorIds(tenantId, contados.map((i) => i.produtoId));
  const mapaProdutos = new Map(produtos.map((p) => [p.id, p]));

  const ajustados = [];
  const pendentesManuais = [];

  for (const item of contados) {
    const sistema = Number(item.quantidadeSistema);
    const contada = Number(item.quantidadeContada);
    if (contada === sistema) continue;

    const produto = mapaProdutos.get(item.produtoId);
    if (produto.controlaLote) {
      pendentesManuais.push({
        produtoId: item.produtoId, produtoNome: produto.nome,
        quantidadeSistema: sistema, quantidadeContada: contada,
      });
      continue;
    }

    const movimentacao = await ajusteEstoqueService.ajusteEstoque(
      tenantId, usuario.id, item.produtoId, inventario.depositoId, contada,
      `Inventário #${id} — contagem física`, undefined, 'inventario', id
    );
    ajustados.push({ produtoId: item.produtoId, produtoNome: produto.nome, movimentacaoId: movimentacao.id, quantidadeAnterior: sistema, quantidadeNova: contada });
  }

  await inventarioRepo.fechar(tenantId, id);

  return {
    fechado: true,
    totalItens: inventario.itens.length,
    itensContados: contados.length,
    itensNaoContados: inventario.itens.length - contados.length,
    ajustados,
    pendentesManuais,
  };
}

module.exports = { iniciarInventario, detalhar, registrarContagem, fecharInventario };
