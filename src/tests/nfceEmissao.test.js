/**
 * Arquivo: nfceEmissao.test.js
 * Responsabilidade: Confirma emitirNfce/cancelarNfce (Fase 1c) — tudo
 * com SEFAZ_MOCK=true, sem rede real. Cobre: configuração fiscal
 * incompleta bloqueando ANTES de qualquer coisa, emissão com sucesso
 * (chave real de 44 dígitos substitui o localId), rejeição da SEFAZ,
 * cancelamento dentro/fora da janela, e contingência SVC (sucesso e
 * indisponibilidade total).
 * Uso: node --test src/tests/nfceEmissao.test.js
 * Depende de: DATABASE_URL válido em .env.
 */
process.env.SEFAZ_MOCK = 'true';
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/database');
const { emitirNfce, cancelarNfce } = require('../services/nfceEmissao.service');
const { resolverUrlsFiscais } = require('../config/webservicesSefaz');
const { criptografar, criptografarTexto } = require('../utils/certcrypto');
const { NFE_SchemaValidate } = require('@nfewizard/nfce');

function cnpjTeste(sufixo) {
  return Date.now().toString().slice(-12) + sufixo;
}

async function criarTenantCompleto(sufixo) {
  return prisma.tenant.create({
    data: {
      nome: 'Teste Emissao NFCe ' + sufixo, cnpj: cnpjTeste(sufixo), email: `emissao-${sufixo}@teste.com`,
      uf: 'PR', regimeTributario: 'real', ambienteFiscal: 'homologacao',
      certificadoPfx: criptografar(Buffer.from('conteudo-fake-do-pfx')),
      certificadoSenha: criptografarTexto('senha-fake'),
      cnae: '4711-3/02', inscricaoEstadual: '123456789',
      cscProducao: criptografarTexto('csc-fake-prod'), cscProducaoId: '1',
      cscHomologacao: criptografarTexto('csc-fake-hom'), cscHomologacaoId: '1',
      logradouro: 'Rua Teste', numero: '100', bairro: 'Centro', municipio: 'Curitiba',
      codigoMunicipioIbge: '4106902', cep: '80000-000',
    },
  });
}

async function criarVendaDeTeste(tenantId, { chaveNfce = 'localid-abc123', emitidoEm } = {}) {
  const produto = await prisma.produto.create({
    data: { tenantId, ean: '97' + Date.now().toString().slice(-11), nome: 'Produto Emissao Teste', preco: 20, ncm: '10063011', cfop: '5102' },
  });
  const venda = await prisma.venda.create({
    data: {
      tenantId, subtotal: 20, total: 20, chaveNfce, emitidoEm,
      itens: { create: [{ produtoId: produto.id, quantidade: 1, precoUnitario: 20, custoUnitario: 10, subtotal: 20, total: 20 }] },
      pagamentos: { create: [{ forma: 'pix', valor: 20 }] },
    },
  });
  return { produto, venda };
}

async function limpar(tenantId, vendaId, produtoId) {
  if (vendaId) {
    await prisma.vendaPagamento.deleteMany({ where: { vendaId } });
    await prisma.vendaItem.deleteMany({ where: { vendaId } });
    await prisma.venda.delete({ where: { id: vendaId } }).catch(() => {});
  }
  if (produtoId) await prisma.produto.delete({ where: { id: produtoId } }).catch(() => {});
  await prisma.auditoria.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
}

test('emitirNfce: configuração fiscal incompleta bloqueia ANTES de gerar XML ou chamar qualquer coisa', async () => {
  const tenant = await prisma.tenant.create({
    data: { nome: 'Teste Emissao Incompleto', cnpj: cnpjTeste('01'), email: 'emissao-incompleto@teste.com' },
  });
  try {
    await assert.rejects(
      () => emitirNfce(tenant.id, 'venda-que-nem-existe'),
      (err) => err.status === 422 && /Configuração fiscal incompleta/.test(err.message)
    );
  } finally {
    await limpar(tenant.id);
  }
});

test('emitirNfce: tenant completo, mock retorna sucesso — chaveNfce vira a chave real de 44 dígitos', async () => {
  const tenant = await criarTenantCompleto('02');
  const { produto, venda } = await criarVendaDeTeste(tenant.id);
  try {
    const atualizada = await emitirNfce(tenant.id, venda.id);
    assert.match(atualizada.chaveNfce, /^\d{44}$/, 'chaveNfce deve virar a chave real de 44 dígitos');
    assert.notEqual(atualizada.chaveNfce, 'localid-abc123');
    assert.ok(atualizada.protocoloAutorizacao);
    assert.equal(atualizada.emitidoViaContingencia, false);
    assert.ok(atualizada.emitidoEm);
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('emitirNfce: mock simula rejeição (cStat != 100) — erro com motivo, Venda não fica com chave inválida', async () => {
  const tenant = await criarTenantCompleto('03');
  const { produto, venda } = await criarVendaDeTeste(tenant.id);
  try {
    const chamarRejeitando = async () => ({ cStat: '204', xMotivo: 'Rejeição: duplicidade de NF-e' });
    await assert.rejects(
      () => emitirNfce(tenant.id, venda.id, { chamarWebservice: chamarRejeitando }),
      (err) => err.status === 422 && /204/.test(err.message) && /duplicidade/.test(err.message)
    );

    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.chaveNfce, 'localid-abc123', 'venda não pode ficar com chave inválida após rejeição');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('emitirNfce: Venda.xmlNfce é populado com o XML gerado tanto em sucesso quanto em rejeição da SEFAZ', async () => {
  const tenantSucesso = await criarTenantCompleto('03b');
  const { produto: produtoSucesso, venda: vendaSucesso } = await criarVendaDeTeste(tenantSucesso.id);
  try {
    const atualizada = await emitirNfce(tenantSucesso.id, vendaSucesso.id);
    assert.ok(atualizada.xmlNfce, 'xmlNfce deve ser populado quando a emissão é aceita');
    assert.match(atualizada.xmlNfce, /<.*NFe/i, 'deve conter algo parecido com XML de NFe');
  } finally {
    await limpar(tenantSucesso.id, vendaSucesso.id, produtoSucesso.id);
  }

  const tenantRejeicao = await criarTenantCompleto('03c');
  const { produto: produtoRejeicao, venda: vendaRejeicao } = await criarVendaDeTeste(tenantRejeicao.id);
  try {
    const chamarRejeitando = async () => ({ cStat: '204', xMotivo: 'Rejeição: duplicidade de NF-e' });
    await assert.rejects(() => emitirNfce(tenantRejeicao.id, vendaRejeicao.id, { chamarWebservice: chamarRejeitando }));

    const depois = await prisma.venda.findUnique({ where: { id: vendaRejeicao.id } });
    assert.ok(depois.xmlNfce, 'xmlNfce deve ser populado MESMO quando a SEFAZ rejeita — é o registro do que foi tentado enviar');
    assert.equal(depois.chaveNfce, 'localid-abc123', 'mas os campos de autorização (chave/protocolo) não podem ser preenchidos numa rejeição');
    assert.equal(depois.protocoloAutorizacao, null);
  } finally {
    await limpar(tenantRejeicao.id, vendaRejeicao.id, produtoRejeicao.id);
  }
});

test('cancelarNfce: dentro da janela — sucesso simulado, status da Venda atualizado', async () => {
  const tenant = await criarTenantCompleto('04');
  const { produto, venda } = await criarVendaDeTeste(tenant.id, { chaveNfce: '3'.repeat(44), emitidoEm: new Date() });
  try {
    const atualizada = await cancelarNfce(tenant.id, venda.id, 'Cliente desistiu da compra no caixa');
    assert.equal(atualizada.status, 'cancelada');
    assert.ok(atualizada.protocoloCancelamento);
    assert.ok(atualizada.canceladoEm);
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('cancelarNfce: fora da janela (emitido há 40 minutos) — erro claro, sem tentar enviar o evento', async () => {
  const tenant = await criarTenantCompleto('05');
  const emitidoEm40minAtras = new Date(Date.now() - 40 * 60 * 1000);
  const { produto, venda } = await criarVendaDeTeste(tenant.id, { chaveNfce: '4'.repeat(44), emitidoEm: emitidoEm40minAtras });
  try {
    let tentouEnviar = false;
    const enviarFake = async () => { tentouEnviar = true; return { ok: true, protocolo: 'X' }; };

    await assert.rejects(
      () => cancelarNfce(tenant.id, venda.id, 'Justificativa de teste com mais de 15 caracteres', { enviarEventoCancelamento: enviarFake }),
      (err) => err.status === 422 && /Prazo de cancelamento expirado/.test(err.message)
    );
    assert.equal(tentouEnviar, false, 'não deveria ter tentado enviar o evento — prazo já tinha expirado');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('falha de conexão no principal — propaga direto (sem SVC), com exatamente 1 chamada de rede, sem chave gravada', async () => {
  const tenant = await criarTenantCompleto('06');
  const { produto, venda } = await criarVendaDeTeste(tenant.id);
  try {
    let chamadas = 0;
    const chamarComFalha = async () => {
      chamadas += 1;
      throw new Error('ECONNREFUSED (simulado) — SEFAZ do estado fora do ar');
    };

    await assert.rejects(
      () => emitirNfce(tenant.id, venda.id, { chamarWebservice: chamarComFalha }),
      (err) => /ECONNREFUSED/.test(err.message)
    );
    assert.equal(chamadas, 1, 'não deve tentar nenhum endpoint alternativo (contingência SVC removida)');

    const depois = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(depois.chaveNfce, 'localid-abc123', 'nenhuma chave deve ser gravada quando a autorização falha por conexão');
  } finally {
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('modo real (SEFAZ_MOCK=false): usa @nfewizard/nfce de verdade — certificado de teste inválido gera erro claro de certificado, sem cair na contingência SVC nem mascarar como "SEFAZ indisponível"', async () => {
  const tenant = await criarTenantCompleto('08');
  const { produto, venda } = await criarVendaDeTeste(tenant.id);
  const mockAnterior = process.env.SEFAZ_MOCK;
  const nodeEnvAnterior = process.env.NODE_ENV;
  try {
    process.env.SEFAZ_MOCK = 'false';
    process.env.NODE_ENV = 'production'; // garante que mockAtivo() não caia no atalho de teste
    // criarTenantCompleto grava um .pfx FAKE (não é um PKCS#12 de verdade) --
    // por isso o próprio carregamento do certificado falha, sem chegar a
    // gerar XML nem tentar rede. Prova que o caminho real está de fato
    // plugado (chama a lib de verdade), sem precisar de certificado real
    // nem de acesso à SEFAZ neste teste automático.
    await assert.rejects(
      () => emitirNfce(tenant.id, venda.id),
      (err) => err.status === 422 && /Certificado digital inválido/.test(err.message)
    );
  } finally {
    process.env.SEFAZ_MOCK = mockAnterior;
    process.env.NODE_ENV = nodeEnvAnterior;
    await limpar(tenant.id, venda.id, produto.id);
  }
});

test('validação de schema (sem rede, sem certificado): XML propositalmente incompleto é rejeitado pelo validador padrão da lib (JS-based, sem Java) com o erro estrutural exato', async () => {
  const xmlIncompleto = `<?xml version="1.0" encoding="UTF-8"?>
<enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <idLote>1</idLote>
  <indSinc>1</indSinc>
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe versao="4.00" Id="NFe41260711222333000181650010000000011123456783">
      <ide>
        <cUF>41</cUF>
      </ide>
    </infNFe>
  </NFe>
</enviNFe>`;

  await assert.rejects(
    () => NFE_SchemaValidate(xmlIncompleto, 'NFEAutorizacao'),
    (erro) => erro.success === false && /cNF/.test(erro.message)
  );
});

/** CNPJ com dígitos verificadores REAIS (mod-11) — necessário pro caminho
 * real (a lib rejeita CNPJ com DV inválido antes de qualquer rede); os
 * testes com mock não precisam disso, só este. */
function gerarCnpjValido() {
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const dv = (nums, pesos) => {
    const resto = nums.reduce((acc, n, i) => acc + n * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const dv1 = dv(base, pesos1);
  const dv2 = dv([...base, dv1], pesos2);
  return [...base, dv1, dv2].join('');
}

/** Igual a criarTenantCompleto, mas com o certificado dummy REAL (não um
 * buffer fake) — só usado pelo teste de integração manual, que precisa
 * que a lib consiga abrir o .pfx de verdade pra chegar até a etapa de
 * rede/TLS. */
async function criarTenantComCertificadoReal(sufixo) {
  const fs = require('fs');
  const path = require('path');
  const pfxBuffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'certificado-teste.pfx'));
  return prisma.tenant.create({
    data: {
      nome: 'Teste Emissao NFCe ' + sufixo, cnpj: gerarCnpjValido(), email: `emissao-${sufixo}@teste.com`,
      uf: 'PR', regimeTributario: 'presumido', ambienteFiscal: 'homologacao',
      certificadoPfx: criptografar(pfxBuffer),
      certificadoSenha: criptografarTexto('senha123'),
      cnae: '4711-3/02', inscricaoEstadual: '1234567890',
      cscProducao: criptografarTexto('csc-fake-prod'), cscProducaoId: '1',
      cscHomologacao: criptografarTexto('99999999-9999-9999-9999-999999999999'), cscHomologacaoId: '1',
      logradouro: 'Rua Teste', numero: '100', bairro: 'Centro', municipio: 'Curitiba',
      codigoMunicipioIbge: '4106902', cep: '80000-000',
    },
  });
}

test('integração manual (TESTE_INTEGRACAO_SEFAZ=true): chamarWebserviceReal (tentativa principal, tpEmis=1) contra a SEFAZ-PR de homologação com certificado dummy — não roda no CI, precisa ser disparado manualmente', { skip: process.env.TESTE_INTEGRACAO_SEFAZ !== 'true' }, async () => {
  const { chamarWebserviceReal } = require('../services/nfceEmissao.service');
  const { gerarXmlNfce } = require('../services/nfceXml.service');

  const tenant = await criarTenantComCertificadoReal('int01');
  const { produto, venda: vendaCriada } = await criarVendaDeTeste(tenant.id);
  try {
    const vendaCarregada = await prisma.venda.findUnique({ where: { id: vendaCriada.id }, include: { itens: { include: { produto: true } }, pagamentos: true } });
    const venda = { ...vendaCarregada, tenant, itens: vendaCarregada.itens };
    const { xml } = gerarXmlNfce(venda, { tpEmis: '1' }); // gerarXmlNfce DE VERDADE, não um JSON escrito à mão

    const urls = resolverUrlsFiscais('PR', 'homologacao');
    await assert.rejects(
      () => chamarWebserviceReal(urls.autorizacao, xml, tenant),
      (erro) => /certificate unknown|EPROTO/i.test(erro.message)
    );
  } finally {
    await limpar(tenant.id, vendaCriada.id, produto.id);
  }
});

test('integração manual (TESTE_INTEGRACAO_SEFAZ=true): emitirNfce — fluxo COMPLETO (emitirNfce -> gerarXmlNfce -> chamarWebserviceReal), sem contingência SVC, contra a SEFAZ-PR de homologação com certificado dummy', { skip: process.env.TESTE_INTEGRACAO_SEFAZ !== 'true' }, async () => {
  const mockAnterior = process.env.SEFAZ_MOCK;
  const nodeEnvAnterior = process.env.NODE_ENV;
  const tenant = await criarTenantComCertificadoReal('int02');
  const { produto, venda } = await criarVendaDeTeste(tenant.id);
  try {
    process.env.SEFAZ_MOCK = 'false';
    process.env.NODE_ENV = 'production';

    // Com a contingência SVC removida, a única tentativa é a principal
    // (tpEmis=1) — o erro observável agora É o "certificado não confiável"
    // de verdade, sem nada mascarando (achado de fase anterior: com SVC
    // habilitada, esse erro era mascarado pela rejeição de schema da 2ª
    // tentativa). A exceção propaga direto de emitirNfce (não é uma
    // AppError 422 "rejeitada pela SEFAZ" -- essa classificação é só pra
    // rejeição de CONTEÚDO, que chega como retorno normal, não exceção).
    await assert.rejects(
      () => emitirNfce(tenant.id, venda.id),
      (erro) => /certificate unknown|EPROTO/i.test(erro.message)
    );

    // A exceção acontece ANTES do save (dentro de autorizarNfce, antes de
    // emitirNfce chegar em vendaRepo.atualizarStatus) -- diferente de uma
    // rejeição de conteúdo, aqui não há XML aceito-ou-rejeitado pra
    // registrar, então xmlNfce continua vazio.
    const vendaFinal = await prisma.venda.findUnique({ where: { id: venda.id } });
    assert.equal(vendaFinal.xmlNfce, null);
    assert.equal(vendaFinal.chaveNfce, 'localid-abc123');
  } finally {
    process.env.SEFAZ_MOCK = mockAnterior;
    process.env.NODE_ENV = nodeEnvAnterior;
    await limpar(tenant.id, venda.id, produto.id);
  }
});

after(async () => {
  await prisma.$disconnect();
});
