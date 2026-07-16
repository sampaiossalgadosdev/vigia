/**
 * Arquivo: fiscal.service.js
 * Responsabilidade: Exportação de XMLs fiscais (entrada + saída) do
 * período pra entrega ao contador externo (Opção B do SPED — Fase 1,
 * fechada neste complemento: o VIGIA só entrega os XMLs em lote, quem
 * gera o SPED em si é o sistema próprio da contadora).
 * Fonte de saída: Venda.xmlNfce (persistido mesmo em rejeição, mas só
 * exportamos quando não-nulo — pendente/não aplicável não tem XML).
 * Fonte de entrada: Nfe.xmlOriginal — é a tabela canônica de nota de
 * entrada confirmada no sistema (via upload manual ou, futuramente,
 * import da Distribuição DF-e). NfeDistribuicao.xmlCompleto (a
 * distribuição bruta, antes de "importada") fica de fora de propósito:
 * exportar de lá arriscaria entregar documento ainda não conciliado.
 * Também expõe o certificado digital do tenant (já descriptografado) pro
 * app ASSINATURA buscar via /api/fiscal/certificado — rota protegida por
 * exigeAcessoCompleto('assinatura_fiscal'), nunca gravado em disco aqui.
 * Utilizado por: FiscalController.
 * Não realiza acesso HTTP.
 */
const prisma = require('../config/database');
const nfeDistRepo = require('../repositories/nfeDistribuicao.repository');
const { descriptografar, descriptografarTexto } = require('../utils/certcrypto');
const { AppError } = require('../utils/response');

function parseData(valor, fimDoDia) {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  if (fimDoDia) data.setHours(23, 59, 59, 999);
  return data;
}

/**
 * Vendas (saída) e Nfe (entrada) do tenant com XML no período. Lança 404
 * claro se não houver nenhum XML — nunca devolve um zip vazio.
 */
async function buscarXmlsDoPeriodo(tenantId, inicio, fim) {
  if (!inicio || !fim) throw new AppError('Informe inicio e fim (AAAA-MM-DD)', 422);
  const dataInicio = parseData(inicio, false);
  const dataFim = parseData(fim, true);
  if (!dataInicio || !dataFim) throw new AppError('Período inválido — use o formato AAAA-MM-DD', 422);

  const [vendas, notasEntrada] = await Promise.all([
    prisma.venda.findMany({
      where: { tenantId, xmlNfce: { not: null }, criadoEm: { gte: dataInicio, lte: dataFim } },
      select: { id: true, chaveNfce: true, xmlNfce: true },
    }),
    prisma.nfe.findMany({
      where: { tenantId, dataEmissao: { gte: dataInicio, lte: dataFim } },
      select: { id: true, chaveAcesso: true, xmlOriginal: true },
    }),
  ]);

  if (vendas.length === 0 && notasEntrada.length === 0)
    throw new AppError('Nenhuma nota fiscal encontrada nesse período', 404);

  return { vendas, notasEntrada };
}

/**
 * Certificado digital do tenant, já descriptografado em memória (nunca
 * gravado em disco nem em log). pfx em base64 porque a resposta HTTP é
 * JSON — o app ASSINATURA re-criptografa isso com safeStorage antes de
 * persistir localmente.
 */
async function buscarCertificadoParaAssinatura(tenantId) {
  const tenant = await nfeDistRepo.buscarTenantComCertificado(tenantId);
  if (!tenant || !tenant.certificadoPfx)
    throw new AppError('Este supermercado não tem certificado digital cadastrado', 422);

  return {
    pfxBase64: descriptografar(Buffer.from(tenant.certificadoPfx)).toString('base64'),
    senha: tenant.certificadoSenha ? descriptografarTexto(tenant.certificadoSenha) : '',
  };
}

module.exports = { buscarXmlsDoPeriodo, buscarCertificadoParaAssinatura };
