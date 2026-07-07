-- Substitui os papéis fixos "gerente"/"operador" por Perfis customizáveis
-- por tenant, com permissões granulares por módulo. "Dono" continua sendo
-- um papel fixo (Usuario.isDono), fora do sistema de Perfis.

-- CreateEnum
CREATE TYPE "PlanoTenant" AS ENUM ('standard', 'pro');

-- CreateEnum
CREATE TYPE "ModuloSistema" AS ENUM ('dashboard', 'produtos', 'fornecedores', 'estoque', 'usuarios', 'perfis', 'vendas', 'promocoes', 'caixa', 'relatorios', 'ia');

-- CreateEnum
CREATE TYPE "NivelPermissao" AS ENUM ('acesso_completo', 'edicao_leitura', 'somente_insercao', 'somente_leitura', 'bloqueado');

-- AlterTable: Tenant.plano (String -> PlanoTenant). Tenants existentes
-- ("basico" ou qualquer outro valor livre) migram para "standard"; só
-- tenants já marcados "pro" continuam "pro".
ALTER TABLE "Tenant" ALTER COLUMN "plano" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "plano" TYPE "PlanoTenant" USING (
  CASE WHEN "plano" = 'pro' THEN 'pro' ELSE 'standard' END
)::"PlanoTenant";
ALTER TABLE "Tenant" ALTER COLUMN "plano" SET DEFAULT 'standard';

-- CreateTable
CREATE TABLE "Perfil" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Perfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissaoPerfil" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "modulo" "ModuloSistema" NOT NULL,
    "nivel" "NivelPermissao" NOT NULL DEFAULT 'bloqueado',

    CONSTRAINT "PermissaoPerfil_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Perfil_tenantId_idx" ON "Perfil"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Perfil_tenantId_nome_key" ON "Perfil"("tenantId", "nome");

-- CreateIndex
CREATE INDEX "PermissaoPerfil_perfilId_idx" ON "PermissaoPerfil"("perfilId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissaoPerfil_perfilId_modulo_key" ON "PermissaoPerfil"("perfilId", "modulo");

-- AddForeignKey
ALTER TABLE "Perfil" ADD CONSTRAINT "Perfil_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissaoPerfil" ADD CONSTRAINT "PermissaoPerfil_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "Perfil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: Usuario ganha isDono/perfilId (perfil String sai no final desta migration)
ALTER TABLE "Usuario" ADD COLUMN "isDono" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Usuario" ADD COLUMN "perfilId" TEXT;

-- CreateIndex
CREATE INDEX "Usuario_perfilId_idx" ON "Usuario"("perfilId");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "Perfil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Migração de dados: papéis fixos → isDono / Perfil ───

-- "dono" antigo vira o papel fixo isDono = true
UPDATE "Usuario" SET "isDono" = true WHERE "perfil" = 'dono';

-- Perfil "Gerente" padrão por tenant: acesso completo em tudo, exceto
-- usuarios/perfis (bloqueado — só o Dono administra usuários e perfis).
INSERT INTO "Perfil" ("id", "tenantId", "nome", "descricao", "ativo", "criadoEm", "atualizadoEm")
SELECT (md5(random()::text || clock_timestamp()::text || t."id" || 'gerente'))::uuid,
       t."id", 'Gerente', 'Perfil padrão criado na migração do papel fixo "gerente".', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t;

-- Perfil "Operador de Caixa" padrão por tenant: somente leitura na
-- retaguarda (ele opera pelo PDV, que não passa pela matriz de permissões).
INSERT INTO "Perfil" ("id", "tenantId", "nome", "descricao", "ativo", "criadoEm", "atualizadoEm")
SELECT (md5(random()::text || clock_timestamp()::text || t."id" || 'operador'))::uuid,
       t."id", 'Operador de Caixa', 'Perfil padrão criado na migração do papel fixo "operador". Opera pelo PDV, não pela retaguarda.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t;

-- Permissões do Perfil "Gerente"
INSERT INTO "PermissaoPerfil" ("id", "perfilId", "modulo", "nivel")
SELECT (md5(random()::text || clock_timestamp()::text || p."id" || m.modulo))::uuid,
       p."id", m.modulo::"ModuloSistema",
       (CASE WHEN m.modulo IN ('usuarios', 'perfis') THEN 'bloqueado' ELSE 'acesso_completo' END)::"NivelPermissao"
FROM "Perfil" p
CROSS JOIN (VALUES ('dashboard'), ('produtos'), ('fornecedores'), ('estoque'), ('usuarios'), ('perfis'), ('vendas'), ('promocoes'), ('caixa'), ('relatorios'), ('ia')) AS m(modulo)
WHERE p."nome" = 'Gerente';

-- Permissões do Perfil "Operador de Caixa"
INSERT INTO "PermissaoPerfil" ("id", "perfilId", "modulo", "nivel")
SELECT (md5(random()::text || clock_timestamp()::text || p."id" || m.modulo))::uuid,
       p."id", m.modulo::"ModuloSistema",
       (CASE WHEN m.modulo IN ('usuarios', 'perfis') THEN 'bloqueado' ELSE 'somente_leitura' END)::"NivelPermissao"
FROM "Perfil" p
CROSS JOIN (VALUES ('dashboard'), ('produtos'), ('fornecedores'), ('estoque'), ('usuarios'), ('perfis'), ('vendas'), ('promocoes'), ('caixa'), ('relatorios'), ('ia')) AS m(modulo)
WHERE p."nome" = 'Operador de Caixa';

-- Usuários "gerente" antigos migram para o Perfil "Gerente" do próprio tenant
UPDATE "Usuario" u
SET "perfilId" = p."id"
FROM "Perfil" p
WHERE p."tenantId" = u."tenantId" AND p."nome" = 'Gerente' AND u."perfil" = 'gerente';

-- Usuários "operador" antigos migram para o Perfil "Operador de Caixa" do próprio tenant
UPDATE "Usuario" u
SET "perfilId" = p."id"
FROM "Perfil" p
WHERE p."tenantId" = u."tenantId" AND p."nome" = 'Operador de Caixa' AND u."perfil" = 'operador';

-- Rede de segurança: qualquer usuário não-dono que tenha ficado sem
-- perfilId (valor de "perfil" fora de dono/gerente/operador) recebe o
-- perfil de menor privilégio do tenant.
UPDATE "Usuario" u
SET "perfilId" = p."id"
FROM "Perfil" p
WHERE p."tenantId" = u."tenantId" AND p."nome" = 'Operador de Caixa'
  AND u."isDono" = false AND u."perfilId" IS NULL;

-- DropIndex
DROP INDEX "Usuario_perfil_idx";

-- AlterTable
ALTER TABLE "Usuario" DROP COLUMN "perfil";
