/**
 * Arquivo: fiscal.controller.js
 * Responsabilidade: Receber req/res das rotas fiscais e delegar ao
 * FiscalService. A exportação de XMLs monta o zip e transmite direto pra
 * resposta HTTP (não usa o helper success() padrão, que é JSON) — é a
 * única exceção nesse sentido no projeto, documentada aqui.
 * Utilizado por: fiscal.routes.js.
 */
const archiver = require('archiver');
const service = require('../services/fiscal.service');
const { asyncHandler, success } = require('../utils/response');

const buscarCertificado = asyncHandler(async (req, res) => {
  const certificado = await service.buscarCertificadoParaAssinatura(req.tenantId);
  success(res, certificado);
});

const exportarXmls = asyncHandler(async (req, res) => {
  const { inicio, fim } = req.query;
  const { vendas, notasEntrada } = await service.buscarXmlsDoPeriodo(req.tenantId, inicio, fim);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="xmls-${inicio}-a-${fim}.zip"`);

  await new Promise((resolve, reject) => {
    const arquivo = archiver('zip', { zlib: { level: 9 } });
    arquivo.on('error', reject);
    res.on('finish', resolve);
    arquivo.pipe(res);

    for (const venda of vendas)
      arquivo.append(venda.xmlNfce, { name: `nfce-${venda.chaveNfce || venda.id}.xml` });
    for (const nfe of notasEntrada)
      arquivo.append(nfe.xmlOriginal, { name: `nfe-entrada-${nfe.chaveAcesso || nfe.id}.xml` });

    arquivo.finalize();
  });
});

module.exports = { buscarCertificado, exportarXmls };
