-- AlterTable
ALTER TABLE "Fornecedor" ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'pessoa_juridica',
ADD COLUMN     "celular" TEXT,
ADD COLUMN     "observacao" TEXT,
ADD COLUMN     "contribuinteIcms" TEXT,
ADD COLUMN     "regimeTributario" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "logradouro" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "cidade" TEXT,
ADD COLUMN     "uf" TEXT,
ADD COLUMN     "finCategoria" TEXT,
ADD COLUMN     "finTipoDocumento" TEXT,
ADD COLUMN     "finConta" TEXT,
ADD COLUMN     "finCentroCusto" TEXT;

-- CreateTable
CREATE TABLE "FornecedorRepresentante" (
    "id" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "celular" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FornecedorRepresentante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CnpjConsultaCache" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "resposta" JSONB NOT NULL,
    "consultadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CnpjConsultaCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FornecedorRepresentante_fornecedorId_idx" ON "FornecedorRepresentante"("fornecedorId");

-- CreateIndex
CREATE UNIQUE INDEX "CnpjConsultaCache_cnpj_key" ON "CnpjConsultaCache"("cnpj");

-- AddForeignKey
ALTER TABLE "FornecedorRepresentante" ADD CONSTRAINT "FornecedorRepresentante_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
