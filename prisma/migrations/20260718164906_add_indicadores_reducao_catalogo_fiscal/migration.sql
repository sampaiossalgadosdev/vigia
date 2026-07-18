-- AlterTable
ALTER TABLE "CatalogoClassTrib" ADD COLUMN     "pRedCbs" DECIMAL(5,2),
ADD COLUMN     "pRedIbs" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "CatalogoCstIbsCbs" ADD COLUMN     "indGIbsCbs" BOOLEAN,
ADD COLUMN     "indGRed" BOOLEAN;
