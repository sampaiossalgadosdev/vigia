/**
 * Arquivo: cnpjConsulta.service.js
 * Responsabilidade: Consultar dados públicos de um CNPJ na API CNPJ.ws e
 * normalizar a resposta para preencher o cadastro de fornecedor.
 * A API pública permite 3 requisições por minuto NO TOTAL (limite do
 * serviço, não por tenant): um throttle de janela deslizante bloqueia a
 * 4ª chamada no minuto, e o resultado fica em cache por 30 dias — o mesmo
 * CNPJ consultado de novo nesse período não gasta o limite.
 * Utilizado por: fornecedor.controller.
 * Depende de: cnpjConsulta.repository, utils/cnpj.
 */
const cnpjConsultaRepo = require('../repositories/cnpjConsulta.repository');
const { validarCnpj, limparCnpj } = require('../utils/cnpj');
const { AppError } = require('../utils/response');

const CACHE_DIAS = 30;
const JANELA_MS = 60 * 1000;
const MAX_POR_JANELA = 3;

// Timestamps das chamadas reais à API no último minuto (janela deslizante).
// Em memória: o limite é do serviço externo, e a app roda numa instância só.
const chamadasRecentes = [];

function throttle() {
  const agora = Date.now();
  while (chamadasRecentes.length && agora - chamadasRecentes[0] > JANELA_MS) chamadasRecentes.shift();
  if (chamadasRecentes.length >= MAX_POR_JANELA) {
    const aguardar = Math.ceil((JANELA_MS - (agora - chamadasRecentes[0])) / 1000);
    throw new AppError(`Limite de consultas atingido. Aguarde ${aguardar}s e tente novamente (ou preencha manualmente).`, 429);
  }
  chamadasRecentes.push(agora);
}

/** Converte a resposta crua do CNPJ.ws nos campos do formulário de fornecedor. */
function normalizarResposta(dados, deCache) {
  const est = dados.estabelecimento || {};
  const telefone = est.ddd1 && est.telefone1 ? `${est.ddd1}${est.telefone1}` : null;
  return {
    razaoSocial: dados.razao_social || null,
    nomeFantasia: est.nome_fantasia || null,
    email: est.email || null,
    telefone,
    cep: est.cep || null,
    logradouro: [est.tipo_logradouro, est.logradouro].filter(Boolean).join(' ') || null,
    numero: est.numero || null,
    complemento: est.complemento || null,
    bairro: est.bairro || null,
    cidade: est.cidade ? est.cidade.nome : null,
    uf: est.estado ? est.estado.sigla : null,
    deCache,
  };
}

async function consultar(cnpjInformado) {
  const cnpj = limparCnpj(cnpjInformado);
  if (!validarCnpj(cnpj)) throw new AppError('CNPJ inválido: confira os 14 dígitos', 422);

  const cache = await cnpjConsultaRepo.buscar(cnpj);
  if (cache && Date.now() - new Date(cache.consultadoEm).getTime() < CACHE_DIAS * 24 * 60 * 60 * 1000) {
    return normalizarResposta(cache.resposta, true);
  }

  throttle();

  let res;
  try {
    res = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, { signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new AppError('Serviço de consulta de CNPJ fora do ar. Preencha os dados manualmente.', 502);
  }

  if (res.status === 404 || res.status === 400)
    throw new AppError('CNPJ não encontrado na base da Receita Federal', 404);
  if (res.status === 429)
    throw new AppError('Limite de consultas do serviço atingido. Aguarde 1 minuto ou preencha manualmente.', 429);
  if (!res.ok)
    throw new AppError('Serviço de consulta de CNPJ indisponível no momento. Preencha os dados manualmente.', 502);

  const dados = await res.json();
  await cnpjConsultaRepo.salvar(cnpj, dados);
  return normalizarResposta(dados, false);
}

module.exports = { consultar };
