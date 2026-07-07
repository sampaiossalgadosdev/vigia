-- CreateTable
CREATE TABLE "Superadmin" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Superadmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Superusuario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Superusuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperusuarioTenant" (
    "id" TEXT NOT NULL,
    "superusuarioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperusuarioTenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "plano" TEXT NOT NULL DEFAULT 'basico',
    "regimeTributario" TEXT NOT NULL DEFAULT 'simples',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "usuarioId" TEXT,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "perfil" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ean" TEXT NOT NULL,
    "codigoInterno" TEXT,
    "plu" TEXT,
    "nome" TEXT NOT NULL,
    "marca" TEXT,
    "ncm" TEXT,
    "unidade" TEXT NOT NULL DEFAULT 'UN',
    "vendidoPorPeso" BOOLEAN NOT NULL DEFAULT false,
    "preco" DECIMAL(10,2) NOT NULL,
    "custoMedio" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "estoqueQtd" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "estoqueMin" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "imagemUrl" TEXT,
    "categoriaId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fornecedor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nfe" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fornecedorId" TEXT,
    "chaveAcesso" TEXT NOT NULL,
    "numeroNfe" TEXT NOT NULL,
    "dataEmissao" TIMESTAMP(3) NOT NULL,
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "xmlOriginal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Nfe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NfeItem" (
    "id" TEXT NOT NULL,
    "nfeId" TEXT NOT NULL,
    "produtoId" TEXT,
    "ean" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ncm" TEXT,
    "unidade" TEXT NOT NULL,
    "quantidade" DECIMAL(10,3) NOT NULL,
    "valorUnitario" DECIMAL(10,4) NOT NULL,
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',

    CONSTRAINT "NfeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentacaoEstoque" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "quantidade" DECIMAL(10,3) NOT NULL,
    "custoUnit" DECIMAL(10,4),
    "origem" TEXT NOT NULL,
    "origemId" TEXT,
    "usuarioId" TEXT,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentacaoEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sugestao" (
    "id" TEXT NOT NULL,
    "superusuarioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sugestao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "usuarioId" TEXT,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT,
    "antes" JSONB,
    "depois" JSONB,
    "ip" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisaoIA" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valorAntes" DECIMAL(10,2),
    "valorDepois" DECIMAL(10,2) NOT NULL,
    "estoqueNaMomento" DECIMAL(10,3) NOT NULL,
    "giro30dias" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "resultadoMargem" DECIMAL(10,2),
    "resultadoVolumeExtra" DECIMAL(10,3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisaoIA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venda" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operadorId" TEXT,
    "total" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "troco" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cpfConsumidor" TEXT,
    "chaveNfce" TEXT,
    "status" TEXT NOT NULL DEFAULT 'concluida',
    "canceladoEm" TIMESTAMP(3),
    "canceladoPor" TEXT,
    "motivoCancelamento" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaItem" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" DECIMAL(10,3) NOT NULL,
    "precoUnitario" DECIMAL(10,2) NOT NULL,
    "custoUnitario" DECIMAL(10,2) NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "promocaoId" TEXT,

    CONSTRAINT "VendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaPagamento" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "forma" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "VendaPagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promocao" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL,
    "leveQtd" INTEGER,
    "pagueQtd" INTEGER,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3) NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promocao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Caixa" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operadorId" TEXT,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadoEm" TIMESTAMP(3),
    "valorAbertura" DECIMAL(10,2) NOT NULL,
    "valorFechamento" DECIMAL(10,2),
    "totalVendas" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalDinheiro" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalCartao" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalPix" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "diferenca" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'aberto',
    "observacao" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sangria" (
    "id" TEXT NOT NULL,
    "caixaId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "motivo" TEXT,
    "operadorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sangria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Superadmin_email_key" ON "Superadmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Superusuario_email_key" ON "Superusuario"("email");

-- CreateIndex
CREATE INDEX "SuperusuarioTenant_superusuarioId_idx" ON "SuperusuarioTenant"("superusuarioId");

-- CreateIndex
CREATE INDEX "SuperusuarioTenant_tenantId_idx" ON "SuperusuarioTenant"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SuperusuarioTenant_superusuarioId_tenantId_key" ON "SuperusuarioTenant"("superusuarioId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_cnpj_key" ON "Tenant"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_usuarioId_idx" ON "RefreshToken"("usuarioId");

-- CreateIndex
CREATE INDEX "Usuario_tenantId_idx" ON "Usuario"("tenantId");

-- CreateIndex
CREATE INDEX "Usuario_perfil_idx" ON "Usuario"("perfil");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_tenantId_email_key" ON "Usuario"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Categoria_tenantId_idx" ON "Categoria"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_tenantId_nome_key" ON "Categoria"("tenantId", "nome");

-- CreateIndex
CREATE INDEX "Produto_tenantId_idx" ON "Produto"("tenantId");

-- CreateIndex
CREATE INDEX "Produto_tenantId_ean_idx" ON "Produto"("tenantId", "ean");

-- CreateIndex
CREATE INDEX "Produto_tenantId_categoriaId_idx" ON "Produto"("tenantId", "categoriaId");

-- CreateIndex
CREATE INDEX "Produto_tenantId_ativo_idx" ON "Produto"("tenantId", "ativo");

-- CreateIndex
CREATE INDEX "Produto_plu_idx" ON "Produto"("plu");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_tenantId_ean_key" ON "Produto"("tenantId", "ean");

-- CreateIndex
CREATE INDEX "Fornecedor_tenantId_idx" ON "Fornecedor"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_tenantId_cnpj_key" ON "Fornecedor"("tenantId", "cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Nfe_chaveAcesso_key" ON "Nfe"("chaveAcesso");

-- CreateIndex
CREATE INDEX "Nfe_tenantId_idx" ON "Nfe"("tenantId");

-- CreateIndex
CREATE INDEX "Nfe_tenantId_status_idx" ON "Nfe"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Nfe_chaveAcesso_idx" ON "Nfe"("chaveAcesso");

-- CreateIndex
CREATE INDEX "NfeItem_nfeId_idx" ON "NfeItem"("nfeId");

-- CreateIndex
CREATE INDEX "NfeItem_produtoId_idx" ON "NfeItem"("produtoId");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_tenantId_idx" ON "MovimentacaoEstoque"("tenantId");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_tenantId_produtoId_idx" ON "MovimentacaoEstoque"("tenantId", "produtoId");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_tenantId_tipo_idx" ON "MovimentacaoEstoque"("tenantId", "tipo");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_criadoEm_idx" ON "MovimentacaoEstoque"("criadoEm");

-- CreateIndex
CREATE INDEX "Sugestao_tenantId_status_idx" ON "Sugestao"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Sugestao_superusuarioId_idx" ON "Sugestao"("superusuarioId");

-- CreateIndex
CREATE INDEX "Auditoria_tenantId_idx" ON "Auditoria"("tenantId");

-- CreateIndex
CREATE INDEX "Auditoria_tenantId_entidade_idx" ON "Auditoria"("tenantId", "entidade");

-- CreateIndex
CREATE INDEX "Auditoria_criadoEm_idx" ON "Auditoria"("criadoEm");

-- CreateIndex
CREATE INDEX "DecisaoIA_tenantId_idx" ON "DecisaoIA"("tenantId");

-- CreateIndex
CREATE INDEX "DecisaoIA_tenantId_produtoId_idx" ON "DecisaoIA"("tenantId", "produtoId");

-- CreateIndex
CREATE INDEX "Venda_tenantId_idx" ON "Venda"("tenantId");

-- CreateIndex
CREATE INDEX "Venda_tenantId_status_idx" ON "Venda"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Venda_tenantId_criadoEm_idx" ON "Venda"("tenantId", "criadoEm");

-- CreateIndex
CREATE INDEX "Venda_operadorId_idx" ON "Venda"("operadorId");

-- CreateIndex
CREATE INDEX "VendaItem_vendaId_idx" ON "VendaItem"("vendaId");

-- CreateIndex
CREATE INDEX "VendaItem_produtoId_idx" ON "VendaItem"("produtoId");

-- CreateIndex
CREATE INDEX "VendaPagamento_vendaId_idx" ON "VendaPagamento"("vendaId");

-- CreateIndex
CREATE INDEX "Promocao_tenantId_idx" ON "Promocao"("tenantId");

-- CreateIndex
CREATE INDEX "Promocao_tenantId_produtoId_ativa_idx" ON "Promocao"("tenantId", "produtoId", "ativa");

-- CreateIndex
CREATE INDEX "Promocao_tenantId_dataFim_idx" ON "Promocao"("tenantId", "dataFim");

-- CreateIndex
CREATE INDEX "Caixa_tenantId_idx" ON "Caixa"("tenantId");

-- CreateIndex
CREATE INDEX "Caixa_tenantId_status_idx" ON "Caixa"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Sangria_caixaId_idx" ON "Sangria"("caixaId");

-- CreateIndex
CREATE INDEX "Sangria_tenantId_idx" ON "Sangria"("tenantId");

-- AddForeignKey
ALTER TABLE "SuperusuarioTenant" ADD CONSTRAINT "SuperusuarioTenant_superusuarioId_fkey" FOREIGN KEY ("superusuarioId") REFERENCES "Superusuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperusuarioTenant" ADD CONSTRAINT "SuperusuarioTenant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nfe" ADD CONSTRAINT "Nfe_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nfe" ADD CONSTRAINT "Nfe_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NfeItem" ADD CONSTRAINT "NfeItem_nfeId_fkey" FOREIGN KEY ("nfeId") REFERENCES "Nfe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NfeItem" ADD CONSTRAINT "NfeItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sugestao" ADD CONSTRAINT "Sugestao_superusuarioId_fkey" FOREIGN KEY ("superusuarioId") REFERENCES "Superusuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sugestao" ADD CONSTRAINT "Sugestao_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisaoIA" ADD CONSTRAINT "DecisaoIA_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisaoIA" ADD CONSTRAINT "DecisaoIA_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_promocaoId_fkey" FOREIGN KEY ("promocaoId") REFERENCES "Promocao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaPagamento" ADD CONSTRAINT "VendaPagamento_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promocao" ADD CONSTRAINT "Promocao_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promocao" ADD CONSTRAINT "Promocao_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sangria" ADD CONSTRAINT "Sangria_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
