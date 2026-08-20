-- Aditiva: colunas nullable, sem default, sem backfill.
-- Assinaturas/cobranças existentes (PIX e cartão avulso antigo) ficam com NULL,
-- que é o estado correto: não têm assinatura recorrente no Mercado Pago.
ALTER TABLE "Assinatura" ADD COLUMN "mpPreapprovalId" TEXT;
ALTER TABLE "Cobranca"   ADD COLUMN "mpPreapprovalId" TEXT;

CREATE UNIQUE INDEX "Assinatura_mpPreapprovalId_key" ON "Assinatura"("mpPreapprovalId");
CREATE INDEX "Cobranca_mpPreapprovalId_idx" ON "Cobranca"("mpPreapprovalId");
