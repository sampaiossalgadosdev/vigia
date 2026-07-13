/**
 * Arquivo: rede.service.js
 * Responsabilidade: Regra de negócio do painel do superusuário (dono de rede):
 * login, cards de lojas com métricas resumidas, métricas detalhadas por loja,
 * comparativo mensal entre lojas e envio de sugestões.
 * Observação Parte 1: sem PDV/vendas ainda, o faturamento é estimado a partir
 * das movimentações de saída (quantidade × preço atual).
 * Utilizado por: RedeController.
 * Depende de: RedeRepository, SugestaoRepository, SuperadminRepository,
 * utils/jwt, utils/bcrypt.
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const crypto = require('crypto');
const redeRepo = require('../repositories/rede.repository');
const sugestaoRepo = require('../repositories/sugestao.repository');
const superadminRepo = require('../repositories/superadmin.repository');
const { gerarAccessToken } = require('../utils/jwt');
const { comparar, gerarHash } = require('../utils/bcrypt');
const { AppError, paginado } = require('../utils/response');

function inicioDoDia(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
function inicioDoMes(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function proximoMes(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function exigirAcesso(superusuario, tenantId) {
  if (!superusuario.tenantIds.includes(tenantId))
    throw new AppError('Esta loja não está atrelada ao seu acesso', 403);
}

async function login(email, senha) {
  const superusuario = await superadminRepo.buscarSuperusuarioPorEmail(email);
  if (!superusuario || !superusuario.ativo || !(await comparar(senha, superusuario.senha)))
    throw new AppError('E-mail ou senha incorretos', 401);
  const accessToken = gerarAccessToken({ sub: superusuario.id }, 'rede');
  return {
    accessToken,
    superusuario: { id: superusuario.id, nome: superusuario.nome, email: superusuario.email },
  };
}

/**
 * Cards de todas as lojas: faturamento do mês, faturamento hoje,
 * ticket médio e rupturas.
 */
async function lojas(superusuario) {
  const tenants = await redeRepo.buscarTenantsResumo(superusuario.tenantIds);
  const agora = new Date();
  const mesInicio = inicioDoMes(agora);
  const hojeInicio = inicioDoDia(agora);
  const amanha = new Date(hojeInicio.getTime() + 24 * 60 * 60 * 1000);

  const cards = [];
  for (const tenant of tenants) {
    const [mes, hoje, rupturas] = await Promise.all([
      redeRepo.faturamentoPeriodo(tenant.id, mesInicio, proximoMes(mesInicio)),
      redeRepo.faturamentoPeriodo(tenant.id, hojeInicio, amanha),
      redeRepo.contarRupturas(tenant.id),
    ]);
    cards.push({
      ...tenant,
      faturamentoMes: mes.total,
      faturamentoHoje: hoje.total,
      ticketMedio: mes.movimentacoes > 0 ? mes.total / mes.movimentacoes : 0,
      rupturas,
    });
  }
  return { lojas: cards };
}

/**
 * Métricas detalhadas de uma loja: KPIs, gráfico 30 dias, top 10 produtos,
 * rupturas e histórico de 6 meses.
 */
async function loja(superusuario, tenantId) {
  exigirAcesso(superusuario, tenantId);
  const [tenant] = await redeRepo.buscarTenantsResumo([tenantId]);
  if (!tenant) throw new AppError('Loja não encontrada', 404);

  const agora = new Date();
  const mesInicio = inicioDoMes(agora);
  const inicio30 = new Date(inicioDoDia(agora).getTime() - 29 * 24 * 60 * 60 * 1000);
  const fim = new Date(inicioDoDia(agora).getTime() + 24 * 60 * 60 * 1000);
  const inicio6m = new Date(agora.getFullYear(), agora.getMonth() - 5, 1);

  const [mes, serie30, top, rupturas, historico, sugestoes] = await Promise.all([
    redeRepo.faturamentoPeriodo(tenantId, mesInicio, proximoMes(mesInicio)),
    redeRepo.vendasPorDia(tenantId, inicio30, fim),
    redeRepo.topProdutos(tenantId, inicio30, fim, 10),
    redeRepo.listarRupturas(tenantId),
    redeRepo.historicoMensal(tenantId, inicio6m),
    sugestaoRepo.listarPorSuperusuario(superusuario.id, { skip: 0, take: 50 }),
  ]);

  return {
    loja: tenant,
    kpis: {
      faturamentoMes: mes.total,
      movimentacoesMes: mes.movimentacoes,
      ticketMedio: mes.movimentacoes > 0 ? mes.total / mes.movimentacoes : 0,
      rupturas: rupturas.length,
    },
    grafico30Dias: serie30,
    topProdutos: top,
    rupturas,
    historico6Meses: historico,
    sugestoesEnviadas: sugestoes.items.filter((s) => s.tenantId === tenantId),
  };
}

/**
 * Comparativo entre lojas em um mês (?mes=YYYY-MM, padrão mês atual).
 */
async function comparativo(superusuario, mesParam) {
  let inicio;
  if (mesParam) {
    if (!/^\d{4}-\d{2}$/.test(mesParam)) throw new AppError('Parâmetro mes deve estar no formato YYYY-MM', 422);
    inicio = new Date(Number(mesParam.slice(0, 4)), Number(mesParam.slice(5, 7)) - 1, 1);
  } else {
    inicio = inicioDoMes(new Date());
  }
  const fim = proximoMes(inicio);

  const tenants = await redeRepo.buscarTenantsResumo(superusuario.tenantIds);
  const linhas = [];
  for (const tenant of tenants) {
    const [periodo, rupturas] = await Promise.all([
      redeRepo.faturamentoPeriodo(tenant.id, inicio, fim),
      redeRepo.contarRupturas(tenant.id),
    ]);
    linhas.push({
      tenantId: tenant.id,
      nome: tenant.nome,
      faturamento: periodo.total,
      movimentacoes: periodo.movimentacoes,
      ticketMedio: periodo.movimentacoes > 0 ? periodo.total / periodo.movimentacoes : 0,
      rupturas,
    });
  }
  linhas.sort((a, b) => b.faturamento - a.faturamento);
  const ranking = linhas.map((l, i) => ({ posicao: i + 1, nome: l.nome, faturamento: l.faturamento }));
  const topRede = await redeRepo.topProdutosRede(superusuario.tenantIds, inicio, fim, 10);

  return {
    mes: `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`,
    lojas: linhas,
    ranking,
    produtosMaisVendidos: topRede,
  };
}

async function enviarSugestao(superusuario, body) {
  const { tenantId, titulo, mensagem, tipo } = body;
  if (!tenantId || !titulo || !mensagem)
    throw new AppError('tenantId, titulo e mensagem são obrigatórios', 422);
  exigirAcesso(superusuario, tenantId);
  const tiposValidos = ['promocao', 'estoque', 'preco', 'geral'];
  return sugestaoRepo.criar({
    superusuarioId: superusuario.id, tenantId, titulo, mensagem,
    tipo: tiposValidos.includes(tipo) ? tipo : 'geral',
  });
}

async function listarSugestoes(superusuario, pag) {
  const { items, total } = await sugestaoRepo.listarPorSuperusuario(superusuario.id, pag);
  return paginado(items, total, pag.page, pag.limit);
}

/**
 * Ponte de acesso do Dono (plano pro) ao Painel da Rede, sem exigir um
 * segundo login: encontra (ou cria) o Superusuário correspondente ao e-mail
 * do Dono, garante o vínculo com o tenant atual e emite um token 'rede'.
 * A senha do Superusuário criado aqui é aleatória e não é entregue ao
 * usuário — o acesso à rede só acontece via esta ponte, a partir do login
 * do tenant.
 */
async function sso(usuarioTenant, tenant) {
  if (!usuarioTenant.isDono) throw new AppError('Apenas o Dono pode acessar o Painel da Rede', 403);
  if (tenant.plano !== 'pro') throw new AppError('O plano deste supermercado não inclui o Painel da Rede', 403);

  let superusuario = await superadminRepo.buscarSuperusuarioPorEmail(usuarioTenant.email);
  if (superusuario && !superusuario.origemSso) {
    // Já existe uma conta de rede "de verdade" (criada pelo Superadmin) com
    // este e-mail — não é a conta-ponte deste Dono. Atrelar o tenant a ela
    // silenciosamente daria a este Dono acesso às lojas de outra rede só por
    // coincidência de e-mail. Ninguém entra pra rede errada por acidente.
    throw new AppError('Já existe uma conta de rede com este e-mail. Fale com o suporte para vincular seu acesso.', 409);
  }
  if (!superusuario) {
    superusuario = await superadminRepo.criarSuperusuario({
      nome: usuarioTenant.nome,
      email: usuarioTenant.email,
      senha: await gerarHash(crypto.randomUUID()),
      origemSso: true,
    });
  }
  if (!superusuario.ativo) throw new AppError('O acesso à rede está inativo. Fale com o suporte.', 403);

  await superadminRepo.atrelarTenants(superusuario.id, [tenant.id]);

  const accessToken = gerarAccessToken({ sub: superusuario.id }, 'rede');
  return {
    accessToken,
    superusuario: { id: superusuario.id, nome: superusuario.nome, email: superusuario.email },
  };
}

module.exports = { login, lojas, loja, comparativo, enviarSugestao, listarSugestoes, sso };
