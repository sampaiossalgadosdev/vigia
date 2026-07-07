/**
 * Arquivo: cnpj.js
 * Responsabilidade: Validação pura de CNPJ (14 dígitos e dígitos verificadores).
 * Utilizado por: validators de fornecedor e superadmin, services de estoque.
 */

/**
 * Remove tudo que não for dígito.
 */
function limparCnpj(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/**
 * Valida um CNPJ (aceita com ou sem máscara). Retorna true/false.
 */
function validarCnpj(valor) {
  const cnpj = limparCnpj(valor);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (nums, pesos) => {
    const soma = nums.reduce((acc, n, i) => acc + n * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const n = cnpj.split('').map(Number);
  const d1 = calc(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(n.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === n[12] && d2 === n[13];
}

module.exports = { validarCnpj, limparCnpj };
