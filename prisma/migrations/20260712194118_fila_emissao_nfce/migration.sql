-- AlterTable
ALTER TABLE "Venda" ADD COLUMN     "proximaTentativaEm" TIMESTAMP(3),
ADD COLUMN     "statusEmissaoFiscal" TEXT NOT NULL DEFAULT 'nao_aplicavel',
ADD COLUMN     "tentativasEmissao" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultimaTentativaEm" TIMESTAMP(3);
