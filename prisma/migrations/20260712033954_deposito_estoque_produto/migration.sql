-- CreateTable
CREATE TABLE "Deposito" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deposito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstoqueProduto" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "depositoId" TEXT NOT NULL,
    "quantidade" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "permiteEstoqueNegativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EstoqueProduto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deposito_tenantId_idx" ON "Deposito"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EstoqueProduto_produtoId_depositoId_key" ON "EstoqueProduto"("produtoId", "depositoId");

-- AddForeignKey
ALTER TABLE "Deposito" ADD CONSTRAINT "Deposito_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstoqueProduto" ADD CONSTRAINT "EstoqueProduto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstoqueProduto" ADD CONSTRAINT "EstoqueProduto_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
