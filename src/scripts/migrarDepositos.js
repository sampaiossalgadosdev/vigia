/**
 * Arquivo: migrarDepositos.js
 * Responsabilidade: Backfill único da Fase 2a — para cada Tenant, garante um
 * "Depósito Principal" e, para cada Produto, cria a linha de EstoqueProduto
 * correspondente com quantidade = Produto.estoqueQtd atual e
 * permiteEstoqueNegativo = true (preserva o comportamento livre de hoje).
 * Idempotente: pode ser rodado mais de uma vez sem duplicar nada (upsert
 * pela unique [produtoId, depositoId]).
 * Uso: node src/scripts/migrarDepositos.js
 */
require('dotenv').config();
const prisma = require('../config/database');
const estoqueDepositoRepo = require('../repositories/estoqueDeposito.repository');

/**
 * Roda o backfill para um único tenant. Extraída à parte (de main()) pra
 * poder ser reaproveitada por teste automatizado sem varrer o banco inteiro.
 */
async function backfillTenant(tenantId) {
  const depositoExistente = await prisma.deposito.findFirst({ where: { tenantId, principal: true } });
  const deposito = await estoqueDepositoRepo.garantirDepositoPrincipal(prisma, tenantId);

  const produtos = await prisma.produto.findMany({
    where: { tenantId },
    select: { id: true, nome: true, estoqueQtd: true },
  });

  const mismatches = [];
  for (const produto of produtos) {
    const estoqueQtdAntes = Number(produto.estoqueQtd);

    await prisma.estoqueProduto.upsert({
      where: { produtoId_depositoId: { produtoId: produto.id, depositoId: deposito.id } },
      update: {},
      create: { produtoId: produto.id, depositoId: deposito.id, quantidade: estoqueQtdAntes, permiteEstoqueNegativo: true },
    });

    const agregado = await prisma.estoqueProduto.aggregate({ where: { produtoId: produto.id }, _sum: { quantidade: true } });
    const soma = Number(agregado._sum.quantidade ?? 0);

    if (soma !== estoqueQtdAntes) {
      mismatches.push({ produtoId: produto.id, nome: produto.nome, esperado: estoqueQtdAntes, obtido: soma });
    } else {
      // Formaliza o invariante (Produto.estoqueQtd = agregado dos depósitos);
      // valor não muda, já que acabamos de copiar ele mesmo pra cá.
      await prisma.produto.update({ where: { id: produto.id }, data: { estoqueQtd: soma } });
    }
  }

  return { depositoCriado: !depositoExistente, produtosProcessados: produtos.length, mismatches };
}

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });

  let depositosCriados = 0;
  let produtosProcessados = 0;
  const mismatches = [];

  for (const tenant of tenants) {
    const resultado = await backfillTenant(tenant.id);
    if (resultado.depositoCriado) depositosCriados++;
    produtosProcessados += resultado.produtosProcessados;
    mismatches.push(...resultado.mismatches);
  }

  console.log('--- Backfill Depósito Principal / EstoqueProduto ---');
  console.log(`Tenants processados: ${tenants.length}`);
  console.log(`Depósitos Principal criados: ${depositosCriados}`);
  console.log(`Produtos processados: ${produtosProcessados}`);
  console.log(`Divergências encontradas: ${mismatches.length}`);
  if (mismatches.length > 0) {
    console.log(JSON.stringify(mismatches, null, 2));
    process.exitCode = 1;
  } else {
    console.log('OK: todos os produtos batem exatamente (sum(EstoqueProduto) === estoqueQtd anterior).');
  }
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}

module.exports = { backfillTenant };
