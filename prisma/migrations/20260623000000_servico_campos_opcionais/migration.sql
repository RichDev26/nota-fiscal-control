-- AlterTable: campos opcionais adicionais do Serviço
ALTER TABLE "Servico" ADD COLUMN "gestor" TEXT;
ALTER TABLE "Servico" ADD COLUMN "comprador" TEXT;
ALTER TABLE "Servico" ADD COLUMN "numeroOF" TEXT;
ALTER TABLE "Servico" ADD COLUMN "numeroOrcamento" TEXT;
