-- AlterTable: dados extraídos do documento (mesmo pipeline das Notas)
ALTER TABLE "Gasto" ADD COLUMN "fornecedorCnpj" TEXT;
ALTER TABLE "Gasto" ADD COLUMN "numeroDocumento" TEXT;
ALTER TABLE "Gasto" ADD COLUMN "serieDocumento" TEXT;
ALTER TABLE "Gasto" ADD COLUMN "produtos" TEXT;
