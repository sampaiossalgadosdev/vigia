-- AlterTable
ALTER TABLE "Venda" ADD COLUMN     "dataVenda" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill explícito: linhas já existentes recebem dataVenda = criadoEm
-- (não confiar no DEFAULT CURRENT_TIMESTAMP acima, que aplicaria "agora"
-- para todo o histórico, apagando o momento real de vendas antigas).
UPDATE "Venda" SET "dataVenda" = "criadoEm";

-- CreateIndex
CREATE INDEX "Venda_tenantId_dataVenda_idx" ON "Venda"("tenantId", "dataVenda");
