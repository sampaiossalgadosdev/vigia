/**
 * Arquivo: configuracaoFiscal.service.js
 * Responsabilidade: Configuração fiscal do tenant para a futura emissão de
 * NFC-e (Reforma Tributária 2026) — CSCs de homologação/produção, CNAE,
 * Inscrição Estadual e ambiente fiscal, e a checagem de completude usada
 * antes de liberar emissão em produção (bloqueio em si fica pra Fase 1c).
 * Fase 1a: só armazenamento — sem cálculo de IBS/CBS, sem montagem de XML,
 * sem chamada à SEFAZ.
 * Utilizado por: SuperadminController.
 * Depende de: SuperadminRepository, AuditoriaRepository, utils/certcrypto,
 * SuperadminService (semSegredosFiscais).
 * Não realiza acesso HTTP nem acesso direto ao Prisma.
 */
const superadminRepo = require('../repositories/superadmin.repository');
const auditoriaRepo = require('../repositories/auditoria.repository');
const { criptografarTexto } = require('../utils/certcrypto');
const { semSegredosFiscais } = require('./superadmin.service');
const { AppError } = require('../utils/response');

const AMBIENTES_FISCAIS = ['homologacao', 'producao'];

/**
 * Grava CSCs, CNAE, Inscrição Estadual e ambiente fiscal. Um CSC só é
 * regravado se um valor novo for enviado — campo vazio não apaga o que já
 * existe, pra não limpar o segredo sem querer ao editar só outro campo
 * desta mesma seção.
 */
async function salvarConfiguracaoFiscal(id, body) {
  const tenant = await superadminRepo.buscarTenantPorId(id);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);

  if (body.ambienteFiscal !== undefined && !AMBIENTES_FISCAIS.includes(body.ambienteFiscal))
    throw new AppError('Ambiente fiscal deve ser homologacao ou producao', 422);

  const dados = {};
  if (body.cnae !== undefined) dados.cnae = body.cnae || null;
  if (body.inscricaoEstadual !== undefined) dados.inscricaoEstadual = body.inscricaoEstadual || null;
  if (body.cscProducaoId !== undefined) dados.cscProducaoId = body.cscProducaoId || null;
  if (body.cscHomologacaoId !== undefined) dados.cscHomologacaoId = body.cscHomologacaoId || null;
  if (body.ambienteFiscal !== undefined) dados.ambienteFiscal = body.ambienteFiscal;
  if (body.cscProducao) dados.cscProducao = criptografarTexto(body.cscProducao);
  if (body.cscHomologacao) dados.cscHomologacao = criptografarTexto(body.cscHomologacao);
  // Endereço do emitente (grupo enderEmit da NFC-e).
  if (body.logradouro !== undefined) dados.logradouro = body.logradouro || null;
  if (body.numero !== undefined) dados.numero = body.numero || null;
  if (body.complemento !== undefined) dados.complemento = body.complemento || null;
  if (body.bairro !== undefined) dados.bairro = body.bairro || null;
  if (body.municipio !== undefined) dados.municipio = body.municipio || null;
  if (body.codigoMunicipioIbge !== undefined) dados.codigoMunicipioIbge = body.codigoMunicipioIbge || null;
  if (body.cep !== undefined) dados.cep = body.cep || null;

  const atualizado = await superadminRepo.atualizarTenant(id, dados);
  // Nunca grava o valor do CSC (nem cifrado) na auditoria — só o "o que mudou".
  await auditoriaRepo.registrar({
    tenantId: id, acao: 'editar', entidade: 'Tenant', entidadeId: id,
    depois: {
      configuracaoFiscalAtualizada: true,
      ambienteFiscal: atualizado.ambienteFiscal,
      cnae: atualizado.cnae,
      inscricaoEstadual: atualizado.inscricaoEstadual,
    },
  });
  return semSegredosFiscais(atualizado);
}

// Campos obrigatórios pra emissão de NFC-e (checados na Fase 1c antes de
// liberar produção). [campo no Tenant, rótulo pra exibir no camposFaltantes]
const CAMPOS_FISCAIS_OBRIGATORIOS = [
  ['certificadoPfx', 'certificado digital (.pfx)'],
  ['certificadoSenha', 'senha do certificado'],
  ['cscProducao', 'CSC de produção'],
  ['cscProducaoId', 'ID do CSC de produção'],
  ['cnae', 'CNAE'],
  ['regimeTributario', 'regime tributário'],
  ['inscricaoEstadual', 'Inscrição Estadual'],
  ['uf', 'UF'],
  // Endereço do emitente (grupo enderEmit da NFC-e) — complemento fica de
  // fora de propósito, é opcional em qualquer endereço (ex: sem apto/sala).
  ['logradouro', 'Logradouro'],
  ['numero', 'Número'],
  ['bairro', 'Bairro'],
  ['municipio', 'Município'],
  ['codigoMunicipioIbge', 'Código do Município (IBGE)'],
  ['cep', 'CEP'],
];

/**
 * Fase 1a: só checa se os campos obrigatórios de configuração fiscal estão
 * preenchidos no banco — não valida nada contra a SEFAZ. Vai ser usada na
 * Fase 1c antes de liberar emissão em ambiente de produção (o bloqueio em
 * si ainda não está implementado aqui).
 */
async function configuracaoFiscalCompleta(tenantId) {
  const tenant = await superadminRepo.buscarTenantPorId(tenantId);
  if (!tenant) throw new AppError('Tenant não encontrado', 404);

  const camposFaltantes = CAMPOS_FISCAIS_OBRIGATORIOS
    .filter(([campo]) => tenant[campo] === null || tenant[campo] === undefined || tenant[campo] === '')
    .map(([, rotulo]) => rotulo);

  return { completa: camposFaltantes.length === 0, camposFaltantes };
}

module.exports = { salvarConfiguracaoFiscal, configuracaoFiscalCompleta };
