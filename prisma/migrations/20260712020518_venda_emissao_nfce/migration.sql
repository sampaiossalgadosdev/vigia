-- AlterTable
ALTER TABLE "Venda" ADD COLUMN     "emitidoEm" TIMESTAMP(3),
ADD COLUMN     "emitidoViaContingencia" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "protocoloAutorizacao" TEXT,
ADD COLUMN     "protocoloCancelamento" TEXT;
