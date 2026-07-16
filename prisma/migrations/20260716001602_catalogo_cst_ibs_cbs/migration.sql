-- CreateTable
CREATE TABLE "CatalogoCstIbsCbs" (
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "dataInicioVigencia" TIMESTAMP(3),
    "dataFimVigencia" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoCstIbsCbs_pkey" PRIMARY KEY ("codigo")
);

-- CreateIndex
CREATE INDEX "CatalogoCstIbsCbs_dataFimVigencia_idx" ON "CatalogoCstIbsCbs"("dataFimVigencia");
