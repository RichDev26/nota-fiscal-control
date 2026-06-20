-- AlterTable: vincular NotaFiscal ao Usuario
ALTER TABLE "NotaFiscal" ADD COLUMN "usuarioId" TEXT;

-- AlterTable: vincular Imposto ao Usuario
ALTER TABLE "Imposto" ADD COLUMN "usuarioId" TEXT;

-- AddForeignKey
ALTER TABLE "NotaFiscal" ADD CONSTRAINT "NotaFiscal_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Imposto" ADD CONSTRAINT "Imposto_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
