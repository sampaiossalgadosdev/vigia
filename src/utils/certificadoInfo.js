/**
 * Arquivo: certificadoInfo.js
 * Responsabilidade: Extrair metadados públicos de um certificado A1 já
 * aberto com node-forge — CNPJ do titular e data de validade. Não faz
 * criptografia (isso é utils/certcrypto.js) nem valida cadeia/revogação,
 * só lê campos públicos do certificado.
 * Utilizado por: SuperadminService (upload de certificado).
 */
const forge = require('node-forge');

/**
 * Certificados e-CNPJ (padrão ICP-Brasil) trazem o Subject CN no formato
 * "RAZAO SOCIAL:14DIGITOSDOCNPJ". Extrai os 14 dígitos finais; retorna
 * null se o CN não seguir essa convenção (não é possível extrair).
 */
function extrairCnpj(certificado) {
  const cn = certificado.subject.getField('CN');
  if (!cn || !cn.value) return null;
  const match = String(cn.value).match(/(\d{14})\s*$/);
  return match ? match[1] : null;
}

function extrairValidade(certificado) {
  return (certificado.validity && certificado.validity.notAfter) || null;
}

/**
 * Recebe um PKCS#12 já aberto (forge.pkcs12.pkcs12FromAsn1) e devolve
 * { cnpj, validade } do certificado principal do bag. cnpj vem null quando
 * o CN não segue a convenção e-CNPJ (não bloqueia o upload por si só).
 */
function extrairDoP12(p12) {
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = (bags[forge.pki.oids.certBag] || [])[0];
  if (!certBag || !certBag.cert) return { cnpj: null, validade: null };
  return { cnpj: extrairCnpj(certBag.cert), validade: extrairValidade(certBag.cert) };
}

module.exports = { extrairDoP12 };
