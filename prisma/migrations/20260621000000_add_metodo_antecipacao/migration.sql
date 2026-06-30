-- AlterTable: registrar qual modo de cálculo foi usado na antecipação
ALTER TABLE "NotaFiscal" ADD COLUMN "metodoAntecipacao" TEXT;
ALTER TABLE "NotaFiscal" ADD COLUMN "taxaAntecipacao" DOUBLE PRECISION;
ALTER TABLE "NotaFiscal" ADD COLUMN "diasAntecipacao" DOUBLE PRECISION;
