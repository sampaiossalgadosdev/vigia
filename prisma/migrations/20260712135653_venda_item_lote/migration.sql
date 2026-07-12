-- CreateTable
CREATE TABLE "VendaItemLote" (
    "id" TEXT NOT NULL,
    "vendaItemId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "quantidade" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "VendaItemLote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendaItemLote_vendaItemId_idx" ON "VendaItemLote"("vendaItemId");

-- CreateIndex
CREATE INDEX "VendaItemLote_loteId_idx" ON "VendaItemLote"("loteId");

-- AddForeignKey
ALTER TABLE "VendaItemLote" ADD CONSTRAINT "VendaItemLote_vendaItemId_fkey" FOREIGN KEY ("vendaItemId") REFERENCES "VendaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaItemLote" ADD CONSTRAINT "VendaItemLote_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
