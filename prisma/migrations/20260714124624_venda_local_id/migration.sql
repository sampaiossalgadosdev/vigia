-- Investigação prévia (rodada contra o banco real antes desta migration):
-- SELECT COUNT(*) FROM "Venda" WHERE "chaveNfce" IS NOT NULL  → 0 linhas.
-- Ou seja, nenhuma venda hoje tem chaveNfce preenchida (nem chave real de
-- 44 dígitos, nem localId legado) — o fluxo de sync (POST /api/sync/vendas)
-- nunca rodou de verdade em produção. Por isso este ADD COLUMN é limpo,
-- sem necessidade de nenhum UPDATE de backfill/migração de dados.

-- AlterTable
ALTER TABLE "Venda" ADD COLUMN     "localId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Venda_localId_key" ON "Venda"("localId");
