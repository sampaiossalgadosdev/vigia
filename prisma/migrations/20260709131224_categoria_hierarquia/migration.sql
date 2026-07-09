-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN     "markupPercent" DECIMAL(5,2),
ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Categoria_parentId_idx" ON "Categoria"("parentId");

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
