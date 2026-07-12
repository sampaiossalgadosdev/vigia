/**
 * Arquivo: configuracao-fiscal-completa.test.js
 * Responsabilidade: Confirma a função configuracaoFiscalCompleta():
 * tenant sem nada preenchido retorna completa:false com a lista de campos
 * faltantes; tenant com tudo preenchido retorna completa:true.
 * Uso: node --test src/tests/configuracao-fiscal-completa.test.js
 * Depende de: DATABASE_URL válido em .env.
 */
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const { configuracaoFiscalCompleta, salvarConfiguracaoFiscal } = require('../services/configuracaoFiscal.service');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');

function cnpjTeste(sufixo) {
  return '95' + Date.now().toString().slice(-11) + sufixo;
}

test('tenant sem nenhum campo fiscal preenchido: completa false com todos os campos faltantes', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Config Fiscal Incompleta', cnpj: cnpjTeste('01'), email: 'config-incompleta@teste.com' },
  });
  try {
    const resultado = await configuracaoFiscalCompleta(tenant.id);
    assert.equal(resultado.completa, false);
    assert.ok(resultado.camposFaltantes.length > 0);
    // regimeTributario tem default 'simples' no schema — não deve aparecer como faltante.
    assert.ok(!resultado.camposFaltantes.includes('regime tributário'));
    // UF não foi informada na criação — deve aparecer como faltante.
    assert.ok(resultado.camposFaltantes.includes('UF'));
    assert.ok(resultado.camposFaltantes.includes('certificado digital (.pfx)'));
    assert.ok(resultado.camposFaltantes.includes('CNAE'));
    assert.ok(resultado.camposFaltantes.includes('Logradouro'));
    assert.ok(resultado.camposFaltantes.includes('Código do Município (IBGE)'));
  } finally {
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

test('tenant com todos os campos fiscais preenchidos: completa true', async () => {
  const tenant = await prisma.tenant.create({
    data: {
      nome: 'Teste Config Fiscal Completa', cnpj: cnpjTeste('02'), email: 'config-completa@teste.com',
      uf: 'SP',
      // Simula o que salvarCertificado() gravaria (sem depender do parse real de .pfx aqui).
      certificadoPfx: criptografar(Buffer.from('conteudo-fake-do-pfx')),
      certificadoSenha: criptografarTexto('senha-fake'),
    },
  });
  try {
    await salvarConfiguracaoFiscal(tenant.id, {
      cnae: '4711-3/02',
      inscricaoEstadual: '123456789',
      ambienteFiscal: 'homologacao',
      cscProducaoId: '1',
      cscProducao: 'csc-producao-fake',
      cscHomologacaoId: '2',
      cscHomologacao: 'csc-homologacao-fake',
      logradouro: 'Rua das Flores', numero: '123', bairro: 'Centro',
      municipio: 'São Paulo', codigoMunicipioIbge: '3550308', cep: '01000-000',
    });

    const resultado = await configuracaoFiscalCompleta(tenant.id);
    assert.deepEqual(resultado.camposFaltantes, []);
    assert.equal(resultado.completa, true);
  } finally {
    await prisma.auditoria.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

test('tenant com tudo preenchido mas com UF limpa depois: completa false e "UF" aparece em camposFaltantes', async () => {
  const tenant = await prisma.tenant.create({
    data: {
      nome: 'Teste Config Fiscal UF Limpa', cnpj: cnpjTeste('03'), email: 'config-uf-limpa@teste.com',
      uf: 'SP',
      certificadoPfx: criptografar(Buffer.from('conteudo-fake-do-pfx')),
      certificadoSenha: criptografarTexto('senha-fake'),
    },
  });
  try {
    await salvarConfiguracaoFiscal(tenant.id, {
      cnae: '4711-3/02', inscricaoEstadual: '123456789', ambienteFiscal: 'homologacao',
      cscProducaoId: '1', cscProducao: 'csc-producao-fake',
      cscHomologacaoId: '2', cscHomologacao: 'csc-homologacao-fake',
      logradouro: 'Rua das Flores', numero: '123', bairro: 'Centro',
      municipio: 'São Paulo', codigoMunicipioIbge: '3550308', cep: '01000-000',
    });
    // Confirma que, com UF preenchida, está completa antes de limpar.
    assert.equal((await configuracaoFiscalCompleta(tenant.id)).completa, true);

    // Simula edição que limpa a UF (já confirmado que a tela de edição permite isso).
    await prisma.tenant.update({ where: { id: tenant.id }, data: { uf: null } });

    const resultado = await configuracaoFiscalCompleta(tenant.id);
    assert.equal(resultado.completa, false);
    assert.ok(resultado.camposFaltantes.includes('UF'));
  } finally {
    await prisma.auditoria.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

test('tenant com tudo preenchido mas faltando um campo de endereço (codigoMunicipioIbge): completa false', async () => {
  const tenant = await prisma.tenant.create({
    data: {
      nome: 'Teste Config Fiscal Sem Endereco', cnpj: cnpjTeste('04'), email: 'config-sem-endereco@teste.com',
      uf: 'SP',
      certificadoPfx: criptografar(Buffer.from('conteudo-fake-do-pfx')),
      certificadoSenha: criptografarTexto('senha-fake'),
    },
  });
  try {
    await salvarConfiguracaoFiscal(tenant.id, {
      cnae: '4711-3/02', inscricaoEstadual: '123456789', ambienteFiscal: 'homologacao',
      cscProducaoId: '1', cscProducao: 'csc-producao-fake',
      cscHomologacaoId: '2', cscHomologacao: 'csc-homologacao-fake',
      // Endereço incompleto de propósito: falta codigoMunicipioIbge.
      logradouro: 'Rua das Flores', numero: '123', bairro: 'Centro',
      municipio: 'São Paulo', cep: '01000-000',
    });

    const resultado = await configuracaoFiscalCompleta(tenant.id);
    assert.equal(resultado.completa, false);
    assert.deepEqual(resultado.camposFaltantes, ['Código do Município (IBGE)']);
  } finally {
    await prisma.auditoria.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  }
});

after(async () => {
  await prisma.$disconnect();
});
