-- AlterTable
ALTER TABLE "Produto" DROP COLUMN "codigoInterno",
ADD COLUMN     "codigoReferencia" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "ultimoCodigoReferencia" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Produto_tenantId_codigoReferencia_key" ON "Produto"("tenantId", "codigoReferencia");
