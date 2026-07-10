/**
 * Arquivo: cnpj.js
 * Responsabilidade: Validação pura de CNPJ e CPF (dígitos verificadores).
 * Utilizado por: validators de fornecedor e superadmin, services de estoque
 * e da consulta de CNPJ.
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

/**
 * Valida um CPF (aceita com ou sem máscara). Retorna true/false.
 * Usado para fornecedor pessoa física (ex: produtor rural).
 */
function validarCpf(valor) {
  const cpf = limparCnpj(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (qtd) => {
    let soma = 0;
    for (let i = 0; i < qtd; i++) soma += Number(cpf[i]) * (qtd + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

module.exports = { validarCnpj, validarCpf, limparCnpj };
