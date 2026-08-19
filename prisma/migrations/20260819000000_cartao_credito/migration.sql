-- Aditiva: só ADD COLUMN com default/nullable. Nenhuma coluna removida,
-- nenhum dado existente alterado. Cobranças PIX atuais continuam válidas:
-- herdam planoId='mensal', moeda='BRL' e mantêm status/metodo intactos.
ALTER TABLE "Cobranca" ADD COLUMN "planoId" TEXT NOT NULL DEFAULT 'mensal';
ALTER TABLE "Cobranca" ADD COLUMN "moeda" TEXT NOT NULL DEFAULT 'BRL';
ALTER TABLE "Cobranca" ADD COLUMN "statusDetalhe" TEXT;
ALTER TABLE "Cobranca" ADD COLUMN "processadaEm" TIMESTAMP(3);
ALTER TABLE "Cobranca" ADD COLUMN "ultimosDigitos" TEXT;
ALTER TABLE "Cobranca" ADD COLUMN "bandeira" TEXT;
ALTER TABLE "Cobranca" ADD COLUMN "parcelas" INTEGER;

-- Índice de apoio para consultas de cobranças por assinatura+status.
CREATE INDEX "Cobranca_assinaturaId_status_idx" ON "Cobranca"("assinaturaId", "status");

-- Marca as cobranças JÁ aprovadas com processadaEm, para que o CAS e a
-- auditoria tenham a data. Usa updatedAt (aproximação segura do momento da
-- aprovação). NÃO altera status de nenhuma linha.
UPDATE "Cobranca" SET "processadaEm" = "updatedAt" WHERE "status" = 'APROVADA' AND "processadaEm" IS NULL;
