/**
 * Arquivo: seed-acougue.js
 * Responsabilidade: Aplicar o catálogo padrão do açougue (prisma/acougue-carnes)
 * num banco JÁ EXISTENTE: garante o grupo "Açougue", cria os subgrupos e as
 * carnes que ainda não existirem em cada tenant. Idempotente — categoria é
 * reaproveitada pelo nome e o produto é pulado se o tenant já tiver o mesmo
 * EAN ou nome.
 * Uso: node scripts/seed-acougue.js            → todos os tenants ativos
 *      node scripts/seed-acougue.js <cnpj|email> → só o tenant indicado
 */
const { PrismaClient } = require('@prisma/client');
const { SUBGRUPOS_ACOUGUE, eanDoPlu } = require('../prisma/acougue-carnes');

const prisma = new PrismaClient();

async function garantirCategoria(tenantId, nome, parentId = null) {
  const existente = await prisma.categoria.findUnique({
    where: { tenantId_nome: { tenantId, nome } },
    include: { _count: { select: { filhos: true } } },
  });
  if (!existente) return prisma.categoria.create({ data: { tenantId, nome, parentId } });
  // Vira subgrupo do Açougue só se estava solta e sem filhos — subgrupo de
  // subgrupo não é permitido (regra do CategoriaService).
  if (parentId && !existente.parentId && existente._count.filhos === 0 && existente.id !== parentId) {
    return prisma.categoria.update({ where: { id: existente.id }, data: { parentId } });
  }
  return existente;
}

async function criarCarne(tenantId, categoriaId, [nome, ncm, preco, custo, estoque, minimo, plu]) {
  const ean = eanDoPlu(plu);
  const jaExiste = await prisma.produto.findFirst({ where: { tenantId, OR: [{ ean }, { nome }] } });
  if (jaExiste) return false;

  // Cód. Ref. sequencial por tenant — mesmo padrão de
  // produto.repository.criarComCodigoSequencial.
  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { ultimoCodigoReferencia: { increment: 1 } },
    });
    await tx.produto.create({
      data: {
        tenantId, ean, nome, ncm, plu, unidade: 'KG', vendidoPorPeso: true,
        preco, custoMedio: custo, estoqueQtd: estoque, estoqueMin: minimo,
        categoriaId, codigoReferencia: String(tenant.ultimoCodigoReferencia),
      },
    });
  });
  return true;
}

async function main() {
  const filtro = process.argv[2];
  const where = { ativo: true };
  if (filtro) {
    const cnpj = filtro.replace(/\D/g, '');
    where.OR = [{ email: filtro }, ...(cnpj ? [{ cnpj }] : [])];
  }
  const tenants = await prisma.tenant.findMany({ where });
  if (!tenants.length) {
    console.log('Nenhum tenant encontrado' + (filtro ? ` para "${filtro}"` : '') + '.');
    return;
  }

  for (const tenant of tenants) {
    console.log(`\n${tenant.nome} (${tenant.cnpj})`);
    const grupo = await garantirCategoria(tenant.id, 'Açougue');
    let criadas = 0;
    let puladas = 0;
    for (const sub of SUBGRUPOS_ACOUGUE) {
      const categoria = await garantirCategoria(tenant.id, sub.nome, grupo.id);
      for (const carne of sub.carnes) {
        if (await criarCarne(tenant.id, categoria.id, carne)) criadas++;
        else puladas++;
      }
    }
    console.log(`  ${criadas} carnes criadas, ${puladas} já existiam.`);
  }
}

main()
  .catch((e) => {
    console.error('Erro no seed do açougue:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
