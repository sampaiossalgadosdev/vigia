-- CreateTable
CREATE TABLE "CatalogoNcm" (
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "dataInicioVigencia" TIMESTAMP(3),
    "dataFimVigencia" TIMESTAMP(3),
    "tipoAto" TEXT,
    "numeroAto" TEXT,
    "anoAto" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoNcm_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "CatalogoCfop" (
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipoOperacao" TEXT NOT NULL,
    "dataInicioVigencia" TIMESTAMP(3),
    "dataFimVigencia" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoCfop_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "CatalogoCst" (
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoCst_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "CatalogoCsosn" (
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoCsosn_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "CatalogoClassTrib" (
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "dispositivoLegal" TEXT,
    "versaoInforme" TEXT,
    "dataInicioVigencia" TIMESTAMP(3),
    "dataFimVigencia" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoClassTrib_pkey" PRIMARY KEY ("codigo")
);

-- CreateIndex
CREATE INDEX "CatalogoNcm_dataFimVigencia_idx" ON "CatalogoNcm"("dataFimVigencia");

-- CreateIndex
CREATE INDEX "CatalogoCfop_dataFimVigencia_idx" ON "CatalogoCfop"("dataFimVigencia");

-- CreateIndex
CREATE INDEX "CatalogoClassTrib_dataFimVigencia_idx" ON "CatalogoClassTrib"("dataFimVigencia");
