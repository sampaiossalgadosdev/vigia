/**
 * Arquivo: acougueTv.service.js
 * Responsabilidade: Regras do Açougue TV — monta o painel de carnes (produtos
 * do grupo "Açougue" e subgrupos) com preço promocional calculado, resolve a
 * tela pública da TV via tvToken e gera/regenera o token do link da TV.
 * Destaque = produto com promoção vigente (percentual/valor_fixo), reusando o
 * módulo Promoções em vez de duplicar dado de desconto.
 * Utilizado por: acougueTv.controller.
 * Depende de: acougueTv.repository, promocao.repository, auditoria.repository.
 */
const crypto = require('crypto');
const acougueTvRepo = require('../repositories/acougueTv.repository');
const promocaoRepo = require('../repositories/promocao.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { AppError } = require('../utils/response');

/**
 * Preço unitário com a promoção aplicada — mesmo cálculo do backend de vendas
 * (venda.service.normalizarPreco): percentual e valor_fixo mudam o preço;
 * leve_pague não altera o unitário.
 */
function precoPromocional(preco, promocao) {
  const base = Number(preco);
  if (!promocao) return null;
  if (promocao.tipo === 'percentual') return Math.round(base * (1 - Number(promocao.desconto) / 100) * 100) / 100;
  if (promocao.tipo === 'valor_fixo') return Math.max(0, Math.round((base - Number(promocao.desconto)) * 100) / 100);
  return null;
}

function montarItem(produto, promocao) {
  const promo = precoPromocional(produto.preco, promocao);
  const preco = Number(produto.preco);
  return {
    id: produto.id,
    nome: produto.nome,
    unidade: produto.unidade,
    imagemUrl: produto.imagemUrl,
    categoria: produto.categoria ? produto.categoria.nome : null,
    preco,
    precoPromocional: promo,
    percentualOff: promo !== null && preco > 0 ? Math.round((1 - promo / preco) * 100) : null,
    destaque: promo !== null,
    // Promoção que sustenta o destaque — o painel usa para editar/encerrar
    promocao: promocao ? { id: promocao.id, dataInicio: promocao.dataInicio, dataFim: promocao.dataFim } : null,
  };
}

/**
 * Produtos exibidos na TV: tudo que está ativo no grupo "Açougue" ou em
 * qualquer subgrupo dele. Sem o grupo, o painel orienta a criá-lo.
 */
async function painel(tenantId) {
  const grupo = await acougueTvRepo.buscarGrupoAcougue(tenantId);
  if (!grupo) return { grupo: null, categorias: [], items: [], total: 0 };

  const categoriaIds = [grupo.id, ...grupo.filhos.map((f) => f.id)];
  const [produtos, promocoes] = await Promise.all([
    acougueTvRepo.listarProdutos(tenantId, categoriaIds),
    promocaoRepo.vigentes(tenantId),
  ]);
  const promoPorProduto = new Map(promocoes.map((p) => [p.produtoId, p]));

  const items = produtos.map((p) => montarItem(p, promoPorProduto.get(p.id)));
  return { grupo: grupo.nome, categorias: grupo.filhos.map((f) => f.nome), items, total: items.length };
}

/** Tela pública da TV: autentica pelo token do link e devolve o mesmo painel. */
async function telaTv(token) {
  if (!token || !String(token).trim()) throw new AppError('Token da TV não informado', 401);
  const tenant = await acougueTvRepo.buscarTenantPorTvToken(String(token).trim());
  if (!tenant) throw new AppError('Token da TV inválido', 401);
  const dados = await painel(tenant.id);
  return { tenantNome: tenant.nome, ...dados };
}

async function obterToken(tenantId) {
  const tenant = await acougueTvRepo.buscarTvToken(tenantId);
  return { tvToken: tenant ? tenant.tvToken : null };
}

// Sem caracteres ambíguos (I/O/0/1) — o token é digitado à mão na TV.
const TOKEN_LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const TOKEN_NUMEROS = '23456789';
const TOKEN_SIMBOLOS = '#$%&*@+';

/** Token curto de 6 caracteres com pelo menos uma letra, um número e um símbolo. */
function gerarTokenCurto() {
  const todos = TOKEN_LETRAS + TOKEN_NUMEROS + TOKEN_SIMBOLOS;
  const sorteia = (chars) => chars[crypto.randomInt(chars.length)];
  const partes = [sorteia(TOKEN_LETRAS), sorteia(TOKEN_NUMEROS), sorteia(TOKEN_SIMBOLOS)];
  while (partes.length < 6) partes.push(sorteia(todos));
  for (let i = partes.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [partes[i], partes[j]] = [partes[j], partes[i]];
  }
  return partes.join('');
}

/**
 * Gera (ou regenera) o token de acesso da TV. Regenerar invalida o token
 * anterior — TVs já conectadas precisam digitar o novo.
 */
async function gerarToken(tenantId, usuario, ip) {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const tvToken = gerarTokenCurto();
    try {
      await acougueTvRepo.definirTvToken(tenantId, tvToken);
      await auditoriaRepo.registrar({
        tenantId, usuarioId: usuario.id, acao: 'editar', entidade: 'Tenant', entidadeId: tenantId,
        depois: { tvToken: 'regenerado' }, ip,
      });
      return { tvToken };
    } catch (e) {
      // P2002 = colisão com o token único de outro tenant: sorteia outro
      if (e.code !== 'P2002') throw e;
    }
  }
  throw new AppError('Não foi possível gerar o token da TV, tente novamente', 500);
}

module.exports = { painel, telaTv, obterToken, gerarToken };
