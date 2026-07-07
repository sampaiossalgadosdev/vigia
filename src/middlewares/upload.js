/**
 * Arquivo: upload.js
 * Responsabilidade: Configuração do multer (armazenamento em memória,
 * limite de 10MB) com filtros para XML e para planilhas (CSV/XLSX).
 * Utilizado por: rotas de estoque (XML de NF-e) e de importação de produtos.
 */
const multer = require('multer');

const LIMITE_BYTES = 10 * 1024 * 1024; // 10MB

const base = { storage: multer.memoryStorage(), limits: { fileSize: LIMITE_BYTES } };

const uploadXml = multer({
  ...base,
  fileFilter: (req, file, cb) => {
    const ok = file.originalname.toLowerCase().endsWith('.xml') ||
      (file.mimetype || '').includes('xml');
    cb(ok ? null : new Error('Envie um arquivo XML de NF-e'), ok);
  },
});

const uploadPlanilha = multer({
  ...base,
  fileFilter: (req, file, cb) => {
    const nome = file.originalname.toLowerCase();
    const ok = nome.endsWith('.csv') || nome.endsWith('.xlsx') || nome.endsWith('.xls');
    cb(ok ? null : new Error('Envie um arquivo CSV ou XLSX'), ok);
  },
});

module.exports = { uploadXml, uploadPlanilha };
