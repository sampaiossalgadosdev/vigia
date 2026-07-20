-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "ultimoNumeroNfce" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Venda" ADD COLUMN     "numeroNfce" INTEGER;
