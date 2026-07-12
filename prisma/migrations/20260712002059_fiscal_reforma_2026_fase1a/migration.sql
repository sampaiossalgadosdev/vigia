-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "brstbs" TEXT,
ADD COLUMN     "cClassTrib" TEXT,
ADD COLUMN     "cstIbsCbs" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "ambienteFiscal" TEXT NOT NULL DEFAULT 'homologacao',
ADD COLUMN     "certificadoValidade" TIMESTAMP(3),
ADD COLUMN     "cnae" TEXT,
ADD COLUMN     "cscHomologacao" TEXT,
ADD COLUMN     "cscHomologacaoId" TEXT,
ADD COLUMN     "cscProducao" TEXT,
ADD COLUMN     "cscProducaoId" TEXT,
ADD COLUMN     "inscricaoEstadual" TEXT;

-- AlterTable
ALTER TABLE "VendaItem" ADD COLUMN     "cClassTribAplicado" TEXT,
ADD COLUMN     "cstIbsCbsAplicado" TEXT,
ADD COLUMN     "valorCbs" DECIMAL(10,2),
ADD COLUMN     "valorIbs" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "VendaPagamento" ADD COLUMN     "valorTributoSegregado" DECIMAL(10,2) DEFAULT 0;
