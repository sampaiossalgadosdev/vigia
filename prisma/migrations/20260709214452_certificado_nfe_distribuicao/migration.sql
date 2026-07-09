-- AlterTable
ALTER TABLE "NfeItem" ADD COLUMN     "fatorConversao" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "certificadoPfx" BYTEA,
ADD COLUMN     "certificadoSenha" TEXT,
ADD COLUMN     "certificadoUploadEm" TIMESTAMP(3),
ADD COLUMN     "uf" TEXT,
ADD COLUMN     "ultimoNsu" TEXT NOT NULL DEFAULT '0';

-- CreateTable
CREATE TABLE "NfeDistribuicao" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nsu" TEXT NOT NULL,
    "chaveAcesso" TEXT NOT NULL,
    "cnpjEmitente" TEXT,
    "nomeEmitente" TEXT,
    "dataEmissao" TIMESTAMP(3),
    "valorTotal" DECIMAL(10,2),
    "serie" TEXT,
    "numero" TEXT,
    "situacao" TEXT,
    "manifestacao" TEXT NOT NULL DEFAULT 'nao_manifestada',
    "natureza" TEXT,
    "xmlCompleto" TEXT,
    "importada" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NfeDistribuicao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NfeDistribuicao_tenantId_idx" ON "NfeDistribuicao"("tenantId");

-- CreateIndex
CREATE INDEX "NfeDistribuicao_tenantId_dataEmissao_idx" ON "NfeDistribuicao"("tenantId", "dataEmissao");

-- CreateIndex
CREATE INDEX "NfeDistribuicao_tenantId_importada_idx" ON "NfeDistribuicao"("tenantId", "importada");

-- CreateIndex
CREATE UNIQUE INDEX "NfeDistribuicao_tenantId_chaveAcesso_key" ON "NfeDistribuicao"("tenantId", "chaveAcesso");

-- AddForeignKey
ALTER TABLE "NfeDistribuicao" ADD CONSTRAINT "NfeDistribuicao_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
