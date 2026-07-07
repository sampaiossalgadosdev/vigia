/**
 * Arquivo: cpf.js
 * Responsabilidade: Validação pura de CPF (formato e dígitos verificadores).
 * Utilizado por: validators.
 */

/**
 * Valida um CPF (aceita com ou sem máscara). Retorna true/false.
 */
function validarCpf(valor) {
  const cpf = String(valor || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (tamanho) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

module.exports = { validarCpf };
