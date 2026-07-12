-- AlterTable
ALTER TABLE "MovimentacaoEstoque" ADD COLUMN     "depositoId" TEXT,
ADD COLUMN     "loteId" TEXT,
ADD COLUMN     "quantidadeAnterior" DECIMAL(10,3),
ADD COLUMN     "quantidadeNova" DECIMAL(10,3);

-- CreateTable
CREATE TABLE "Inventario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "depositoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "categoriaFiltro" TEXT,
    "status" TEXT NOT NULL DEFAULT 'aberto',
    "iniciadoPorId" TEXT NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEm" TIMESTAMP(3),

    CONSTRAINT "Inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventarioItem" (
    "id" TEXT NOT NULL,
    "inventarioId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidadeSistema" DECIMAL(10,3) NOT NULL,
    "quantidadeContada" DECIMAL(10,3),
    "contadoPorId" TEXT,
    "contadoEm" TIMESTAMP(3),

    CONSTRAINT "InventarioItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Inventario_tenantId_idx" ON "Inventario"("tenantId");

-- CreateIndex
CREATE INDEX "Inventario_tenantId_status_idx" ON "Inventario"("tenantId", "status");

-- CreateIndex
CREATE INDEX "InventarioItem_inventarioId_idx" ON "InventarioItem"("inventarioId");

-- CreateIndex
CREATE INDEX "InventarioItem_produtoId_idx" ON "InventarioItem"("produtoId");

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventario" ADD CONSTRAINT "Inventario_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventario" ADD CONSTRAINT "Inventario_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventarioItem" ADD CONSTRAINT "InventarioItem_inventarioId_fkey" FOREIGN KEY ("inventarioId") REFERENCES "Inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
