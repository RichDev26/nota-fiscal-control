-- CreateTable: ArquivoUpload — backup em banco dos arquivos de /api/uploads
-- (o disco é efêmero em produção; este é o respaldo, mesmo padrão de NotaFiscal.pdfData)
CREATE TABLE "ArquivoUpload" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "dados" TEXT NOT NULL,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArquivoUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArquivoUpload_filename_key" ON "ArquivoUpload"("filename");

-- CreateIndex
CREATE INDEX "ArquivoUpload_usuarioId_idx" ON "ArquivoUpload"("usuarioId");
