/**
 * Arquivo: certcrypto.js
 * Responsabilidade: Criptografia do certificado digital do tenant (arquivo
 * .pfx e senha) com AES-256-GCM e chave mestra em CERT_ENCRYPTION_KEY
 * (64 caracteres hex = 32 bytes). O conteúdo em claro só existe em memória,
 * no momento do uso — nunca em disco nem em log.
 * Utilizado por: SuperadminService (gravação), SefazService (leitura).
 * Formato do payload: iv (12 bytes) + authTag (16 bytes) + ciphertext.
 */
const crypto = require('crypto');
const { AppError } = require('./response');

const IV_BYTES = 12;
const TAG_BYTES = 16;

function chaveMestra() {
  const hex = process.env.CERT_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex))
    throw new AppError('CERT_ENCRYPTION_KEY ausente ou inválida (esperado 64 caracteres hex) — configure a variável de ambiente', 500);
  return Buffer.from(hex, 'hex');
}

/** Criptografa um Buffer; retorna Buffer iv+tag+ciphertext. */
function criptografar(plano) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', chaveMestra(), iv);
  const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), cifrado]);
}

/** Descriptografa um Buffer no formato iv+tag+ciphertext; retorna Buffer. */
function descriptografar(payload) {
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const cifrado = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', chaveMestra(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]);
}

/** Criptografa uma string; retorna base64 (pra colunas String). */
function criptografarTexto(texto) {
  return criptografar(Buffer.from(texto, 'utf8')).toString('base64');
}

/** Descriptografa o base64 gerado por criptografarTexto. */
function descriptografarTexto(base64) {
  return descriptografar(Buffer.from(base64, 'base64')).toString('utf8');
}

module.exports = { criptografar, descriptografar, criptografarTexto, descriptografarTexto };
