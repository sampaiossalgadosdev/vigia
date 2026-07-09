/**
 * Arquivo: nfeEntrada.service.js
 * Responsabilidade: Regra de negócio do painel de NF-e de entrada:
 * consulta SEFAZ (sync + filtros sobre a base local), importação das notas
 * selecionadas (manifestação + download do XML + pipeline de importação já
 * existente), histórico e matching de itens com conversão de unidade.
 * Utilizado por: NfeEntradaController.
 * Depende de: SefazService, EstoqueService, repositórios.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const sefazService = require('./sefaz.service');
const estoqueService = require('./estoque.service');
const estoqueRepo = require('../repositories/estoque.repository');
const nfeDistRepo = require('../repositories/nfeDistribuicao.repository');
const produtoRepo = require('../repositories/produto.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { AppError, paginado } = require('../utils/response');

const MANIFESTACOES_VALIDAS = ['nao_manifestada', 'ciencia', 'confirmada', 'desconhecida', 'nao_realizada'];

function lerPeriodo(dataInicio, dataFim) {
  const inicio = dataInicio ? new Date(dataInicio) : null;
  const fim = dataFim ? new Date(dataFim + 'T23:59:59.999') : null;
  if ((inicio && Number.isNaN(inicio.getTime())) || (fim && Number.isNaN(fim.getTime())))
    throw new AppError('Período inválido — use datas no formato AAAA-MM-DD', 422);
  return { inicio, fim };
}

async function tenantComCertificado(tenantId) {
  const tenant = await nfeDistRepo.buscarTenantComCertificado(tenantId);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);
  return tenant;
}

/**
 * Sincroniza os NSUs novos na SEFAZ e devolve as notas da base local que
 * caem no período/filtro de manifestação pedidos.
 */
async function consultarSefaz(tenantId, body) {
  const tenant = await tenantComCertificado(tenantId);
  const { inicio, fim } = lerPeriodo(body.dataInicio, body.dataFim);

  let manifestacoes = null;
  if (Array.isArray(body.filtroManifestacao) && body.filtroManifestacao.length) {
    manifestacoes = body.filtroManifestacao.filter((m) => MANIFESTACOES_VALIDAS.includes(m));
    if (!manifestacoes.length) throw new AppError('Filtro de manifestação inválido', 422);
  }

  const sync = await sefazService.sincronizar(tenant);
  const notas = await nfeDistRepo.listar(tenantId, { dataInicio: inicio, dataFim: fim, manifestacoes });

  return {
    sincronizacao: sync,
    notas: notas.map((n) => ({
      chaveAcesso: n.chaveAcesso,
      dataEmissao: n.dataEmissao,
      fornecedor: n.nomeEmitente,
      cnpjFornecedor: n.cnpjEmitente,
      valorTotal: n.valorTotal,
      serie: n.serie,
      numero: n.numero,
      manifestacao: n.manifestacao,
      situacao: n.situacao === '1' ? 'autorizada' : n.situacao === '2' ? 'cancelada' : n.situacao === '3' ? 'denegada' : '-',
      natureza: n.natureza || null,
      importada: n.importada,
    })),
  };
}

/**
 * "Trazer notas selecionadas": pra cada chave — manifesta Ciência da Operação
 * se ainda não manifestada, baixa o XML completo (se ainda não veio pela
 * distribuição) e roda o MESMO pipeline do upload manual
 * (estoqueService.uploadNfe). Falha em uma nota não interrompe as demais.
 */
async function importar(tenantId, chavesNfe, usuario, ip) {
  if (!Array.isArray(chavesNfe) || chavesNfe.length === 0)
    throw new AppError('Informe as chaves das notas a importar', 422);
  const tenant = await tenantComCertificado(tenantId);

  const registros = [];
  for (const chave of [...new Set(chavesNfe)]) {
    const registro = await nfeDistRepo.buscarPorChave(tenantId, String(chave));
    if (!registro) throw new AppError('Nota ' + chave + ' não encontrada na consulta — pesquise novamente antes de importar', 422);
    if (registro.situacao === '2') throw new AppError('A nota ' + chave + ' está cancelada na SEFAZ e não pode ser importada', 422);
    registros.push(registro);
  }

  // 1. Manifestação (Ciência da Operação) das ainda não manifestadas, em lote.
  const semManifesto = registros.filter((r) => r.manifestacao === 'nao_manifestada');
  if (semManifesto.length) {
    const resultado = await sefazService.manifestar(tenant, semManifesto.map((r) => r.chaveAcesso));
    for (const r of semManifesto) {
      const ret = resultado[r.chaveAcesso];
      if (ret && ret.ok) {
        r.manifestacao = 'ciencia';
        await nfeDistRepo.atualizar(r.id, { manifestacao: 'ciencia' });
      } else {
        r.erroManifestacao = (ret && ret.motivo) || 'manifestação não confirmada pela SEFAZ';
      }
    }
  }

  // 2. Download do XML + pipeline de importação, nota a nota.
  const resumo = { importadas: 0, jaImportadas: 0, falhas: [] };
  for (const registro of registros) {
    if (registro.erroManifestacao) {
      resumo.falhas.push({ chave: registro.chaveAcesso, motivo: registro.erroManifestacao });
      continue;
    }
    try {
      let xml = registro.xmlCompleto;
      if (!xml) {
        xml = await sefazService.baixarXml(tenant, registro.chaveAcesso);
        await nfeDistRepo.atualizar(registro.id, { xmlCompleto: xml });
      }
      await estoqueService.uploadNfe(tenantId, Buffer.from(xml, 'utf8'), usuario, ip);
      await nfeDistRepo.atualizar(registro.id, { importada: true });
      resumo.importadas += 1;
    } catch (e) {
      if (e.status === 409) { // chave duplicada: já entrou antes (ex.: upload manual)
        await nfeDistRepo.atualizar(registro.id, { importada: true });
        resumo.jaImportadas += 1;
      } else {
        resumo.falhas.push({ chave: registro.chaveAcesso, motivo: e.message });
      }
    }
  }

  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'importar', entidade: 'Nfe',
    depois: { origem: 'sefaz', solicitadas: registros.length, ...resumo, falhas: resumo.falhas.length }, ip,
  });
  return resumo;
}

/** Histórico das Nfe importadas (SEFAZ ou upload manual), com período. */
async function historico(tenantId, query, pag) {
  const { inicio, fim } = lerPeriodo(query.dataInicio, query.dataFim);
  const { items, total } = await estoqueRepo.listarNfes(
    tenantId,
    { status: query.status, dataInicio: inicio, dataFim: fim },
    pag
  );
  return paginado(items, total, pag.page, pag.limit);
}

async function itens(tenantId, nfeId) {
  return estoqueService.detalharNfe(tenantId, nfeId);
}

/**
 * Matching: vincula um item pendente a um produto com fator de conversão de
 * unidade obrigatório. Quantidade que entra no estoque = quantidade da nota
 * × fator; o custo unitário é dividido pelo fator (mesma grandeza final).
 */
async function vincular(tenantId, nfeId, itemId, body, usuario, ip) {
  const fator = Number(body.fatorConversao);
  if (!(fator > 0))
    throw new AppError('Fator de conversão é obrigatório e deve ser maior que zero (use 1 quando as unidades forem iguais)', 422);

  const nfe = await estoqueService.detalharNfe(tenantId, nfeId);
  const item = await estoqueRepo.buscarItemNfe(nfeId, itemId);
  if (!item) throw new AppError('Item da NF-e não encontrado', 404);
  if (item.status !== 'pendente') throw new AppError('Este item não está pendente de vínculo', 409);

  const produto = await produtoRepo.buscarPorId(tenantId, body.produtoId);
  if (!produto || !produto.ativo) throw new AppError('Produto não encontrado neste supermercado', 404);

  const aplicarEntrada = nfe.status === 'confirmada';
  const atualizado = await estoqueRepo.vincularItemTransacao(nfe, item, produto.id, usuario.id, aplicarEntrada, fator);

  await auditoriaRepo.registrar({
    tenantId, usuarioId: usuario.id, acao: 'editar', entidade: 'Nfe', entidadeId: nfeId,
    depois: {
      itemVinculado: item.descricao, produto: produto.nome,
      unidadeNota: body.unidadeNota || item.unidade, unidadeSistema: body.unidadeSistema || produto.unidade,
      fatorConversao: fator, quantidadeFinal: Number(item.quantidade) * fator, entradaAplicada: aplicarEntrada,
    },
    ip,
  });
  return { ...atualizado, quantidadeFinal: Number(item.quantidade) * fator };
}

/** Autocomplete de produto pro matching (permissão do módulo estoque). */
async function buscarProdutos(tenantId, nome) {
  if (!nome || nome.trim().length < 2) return [];
  const { items } = await produtoRepo.listar(tenantId, { nome: nome.trim() }, { skip: 0, take: 8, order: 'asc' });
  return items.map((p) => ({ id: p.id, nome: p.nome, unidade: p.unidade, codigoReferencia: p.codigoReferencia }));
}

module.exports = { consultarSefaz, importar, historico, itens, vincular, buscarProdutos };
