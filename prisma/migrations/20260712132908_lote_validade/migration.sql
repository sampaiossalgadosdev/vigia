-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "controlaLote" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Lote" (
    "id" TEXT NOT NULL,
    "estoqueProdutoId" TEXT NOT NULL,
    "numeroLote" TEXT,
    "dataValidade" TIMESTAMP(3) NOT NULL,
    "quantidade" DECIMAL(10,3) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lote_estoqueProdutoId_idx" ON "Lote"("estoqueProdutoId");

-- CreateIndex
CREATE INDEX "Lote_estoqueProdutoId_ativo_dataValidade_idx" ON "Lote"("estoqueProdutoId", "ativo", "dataValidade");

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_estoqueProdutoId_fkey" FOREIGN KEY ("estoqueProdutoId") REFERENCES "EstoqueProduto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
