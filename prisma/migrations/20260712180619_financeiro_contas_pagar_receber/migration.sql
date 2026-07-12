-- AlterEnum
ALTER TYPE "ModuloSistema" ADD VALUE 'financeiro';

-- CreateTable
CREATE TABLE "ContaPagar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fornecedorId" TEXT,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "dataPagamento" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'aberto',
    "formaPagamento" TEXT,
    "observacao" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContaPagar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContaReceber" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendaId" TEXT,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "dataRecebimento" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'aberto',
    "formaRecebimento" TEXT,
    "observacao" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContaReceber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContaPagar_tenantId_idx" ON "ContaPagar"("tenantId");

-- CreateIndex
CREATE INDEX "ContaPagar_tenantId_status_idx" ON "ContaPagar"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ContaPagar_tenantId_dataVencimento_idx" ON "ContaPagar"("tenantId", "dataVencimento");

-- CreateIndex
CREATE INDEX "ContaReceber_tenantId_idx" ON "ContaReceber"("tenantId");

-- CreateIndex
CREATE INDEX "ContaReceber_tenantId_status_idx" ON "ContaReceber"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ContaReceber_tenantId_dataVencimento_idx" ON "ContaReceber"("tenantId", "dataVencimento");

-- AddForeignKey
ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaReceber" ADD CONSTRAINT "ContaReceber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaReceber" ADD CONSTRAINT "ContaReceber_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
