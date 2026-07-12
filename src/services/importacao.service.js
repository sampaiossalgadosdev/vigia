/**
 * Arquivo: importacao.service.js
 * Responsabilidade: Fluxo de importação em lote de produtos em duas etapas
 * (preview com validação linha a linha e confirmação transacional com token
 * em memória com TTL de 10 minutos), além do modelo XLSX para download.
 * Utilizado por: ProdutoController, SuperadminController.
 * Depende de: ProdutoRepository, AuditoriaRepository, utils/planilha, config/database ($transaction).
 */
const crypto = require('crypto');
const prisma = require('../config/database');
const produtoRepo = require('../repositories/produto.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');
const { lerPlanilha, gerarModeloXlsx } = require('../utils/planilha');
const { AppError } = require('../utils/response');

const LIMITE_LINHAS = 5000;
const TTL_MS = 10 * 60 * 1000;
const UNIDADES = ['UN', 'KG', 'CX', 'L', 'PC', 'FD'];

// Armazenamento em memória dos previews aguardando confirmação
const previews = new Map();

function limparExpirados() {
  const agora = Date.now();
  for (const [token, dados] of previews) if (dados.expiraEm < agora) previews.delete(token);
}

/**
 * Valida uma linha da planilha com as mesmas regras do cadastro individual.
 * Retorna { dados, erros }.
 */
function validarLinha(linha) {
  const erros = [];
  const ean = String(linha.ean || '').replace(/\D/g, '');
  const nome = String(linha.nome || '').trim();
  const preco = Number(String(linha.preco || '').replace(',', '.'));
  const custo = linha.custo !== '' && linha.custo !== undefined ? Number(String(linha.custo).replace(',', '.')) : 0;
  const estoque = linha.estoque_atual !== '' && linha.estoque_atual !== undefined ? Number(String(linha.estoque_atual).replace(',', '.')) : 0;
  const minimo = linha.estoque_minimo !== '' && linha.estoque_minimo !== undefined ? Number(String(linha.estoque_minimo).replace(',', '.')) : 0;
  const ncm = String(linha.ncm || '').replace(/\D/g, '');
  const unidade = String(linha.unidade || 'UN').trim().toUpperCase();
  const plu = String(linha.plu || '').replace(/\D/g, '');
  const vendidoPorPeso = ['sim', 's', 'true', '1', 'x'].includes(String(linha.vendido_por_peso || '').trim().toLowerCase());

  if (!/^\d{8}$|^\d{12,14}$/.test(ean)) erros.push('EAN inválido');
  if (nome.length < 2 || nome.length > 200) erros.push('nome obrigatório (2 a 200 caracteres)');
  if (!(preco > 0) || preco > 999999.99) erros.push('preço obrigatório e maior que zero');
  if (Number.isNaN(custo) || custo < 0) erros.push('custo deve ser >= 0');
  if (Number.isNaN(estoque)) erros.push('estoque_atual inválido');
  if (Number.isNaN(minimo) || minimo < 0) erros.push('estoque_minimo deve ser >= 0');
  if (ncm && !/^\d{8}$/.test(ncm)) erros.push('NCM deve ter 8 dígitos');
  if (!UNIDADES.includes(unidade)) erros.push('unidade deve ser UN, KG, CX, L, PC ou FD');
  if (vendidoPorPeso && !/^\d{4,6}$/.test(plu)) erros.push('PLU obrigatório (4 a 6 dígitos) para produto por peso');

  return {
    erros,
    dados: {
      ean, nome, preco,
      marca: String(linha.marca || '').trim() || null,
      ncm: ncm || null, unidade,
      custoMedio: custo, estoqueQtd: estoque, estoqueMin: minimo,
      categoriaNome: String(linha.categoria || '').trim() || null,
      plu: vendidoPorPeso ? plu : null,
      vendidoPorPeso,
    },
  };
}

/**
 * Etapa 1 — preview: valida o arquivo inteiro sem salvar nada e devolve
 * a prévia com token de confirmação (TTL 10 minutos).
 */
async function preview(tenantId, arquivo) {
  if (!arquivo) throw new AppError('Envie o arquivo CSV ou XLSX', 422);

  let linhas;
  try {
    linhas = lerPlanilha(arquivo.buffer, arquivo.mimetype, arquivo.originalname);
  } catch (e) {
    throw new AppError(e.message, 422);
  }
  if (linhas.length === 0) throw new AppError('O arquivo não possui linhas de dados', 422);
  if (linhas.length > LIMITE_LINHAS)
    throw new AppError(`O arquivo excede o limite de ${LIMITE_LINHAS} linhas`, 422);

  const eansExistentes = new Set(
    (await produtoRepo.buscarPorEans(tenantId, linhas.map((l) => String(l.ean || '').replace(/\D/g, '')).filter(Boolean)))
      .map((p) => p.ean)
  );

  const vistosNoArquivo = new Set();
  const itensPreview = [];
  const validos = [];

  linhas.forEach((linha, indice) => {
    const numeroLinha = indice + 2; // linha 1 = cabeçalho
    const { erros, dados } = validarLinha(linha);

    if (erros.length === 0 && vistosNoArquivo.has(dados.ean))
      erros.push('EAN duplicado no arquivo (primeira ocorrência mantida)');
    if (erros.length === 0 && eansExistentes.has(dados.ean))
      erros.push('EAN já cadastrado neste supermercado (será ignorado)');

    if (erros.length === 0) {
      vistosNoArquivo.add(dados.ean);
      validos.push(dados);
      itensPreview.push({ linha: numeroLinha, nome: dados.nome, ean: dados.ean, status: 'valido' });
    } else {
      itensPreview.push({ linha: numeroLinha, nome: dados.nome || null, ean: dados.ean || null, status: 'invalido', erros });
    }
  });

  limparExpirados();
  const tokenImportacao = crypto.randomUUID();
  previews.set(tokenImportacao, { tenantId, validos, expiraEm: Date.now() + TTL_MS });

  return {
    total: linhas.length,
    validos: validos.length,
    invalidos: linhas.length - validos.length,
    itens: itensPreview,
    tokenImportacao,
  };
}

/**
 * Etapa 2 — confirmar: valida o token e insere todos os válidos em transação
 * (createMany com skipDuplicates).
 */
async function confirmar(tenantId, tokenImportacao, usuario, ip) {
  limparExpirados();
  const registro = previews.get(tokenImportacao);
  if (!registro || registro.tenantId !== tenantId)
    throw new AppError('Token de importação inválido ou expirado. Refaça o preview.', 422);
  previews.delete(tokenImportacao);

  const resultado = await prisma.$transaction(async (tx) => {
    // Resolve categorias por nome (cria as inexistentes)
    const cacheCategorias = new Map();
    const dados = [];
    for (const item of registro.validos) {
      let categoriaId = null;
      if (item.categoriaNome) {
        if (!cacheCategorias.has(item.categoriaNome)) {
          const categoria = await produtoRepo.buscarOuCriarCategoria(tx, tenantId, item.categoriaNome);
          cacheCategorias.set(item.categoriaNome, categoria.id);
        }
        categoriaId = cacheCategorias.get(item.categoriaNome);
      }
      const { categoriaNome, ...resto } = item;
      dados.push({ ...resto, categoriaId, tenantId });
    }
    const criados = await produtoRepo.criarVarios(tx, dados);

    // Fase 2a: cada produto recém-criado nasce com sua linha de estoque no
    // Depósito Principal. createMany não devolve ids, então rebusca pelos
    // EANs enviados; skipDuplicates protege contra reprocessar um produto
    // já existente que por acaso compartilhe EAN (ignorado pelo createMany
    // acima, mas que já pode ter EstoqueProduto).
    if (criados.count > 0) {
      const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(tx, tenantId);
      const eansEnviados = dados.map((d) => d.ean);
      const produtosCriados = await tx.produto.findMany({
        where: { tenantId, ean: { in: eansEnviados } },
        select: { id: true, estoqueQtd: true },
      });
      await tx.estoqueProduto.createMany({
        data: produtosCriados.map((p) => ({ produtoId: p.id, depositoId: deposito.id, quantidade: p.estoqueQtd })),
        skipDuplicates: true,
      });
    }

    return { enviados: registro.validos.length, inseridos: criados.count, ignorados: registro.validos.length - criados.count };
  });

  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario ? usuario.id : null, acao: 'importar', entidade: 'Produto',
    depois: resultado, ip,
  });
  return resultado;
}

/**
 * Gera o Buffer do modelo.xlsx de importação.
 */
function modelo() {
  return gerarModeloXlsx();
}

module.exports = { preview, confirmar, modelo };
