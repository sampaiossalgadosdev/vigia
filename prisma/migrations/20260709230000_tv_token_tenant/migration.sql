-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "tvToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_tvToken_key" ON "Tenant"("tvToken");
