-- CreateTable: Colaborador (Controle de Integração)
CREATE TABLE "Colaborador" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Colaborador_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DocumentoColaborador (genérico por tipo — INTEGRACAO, ASO, futuros)
CREATE TABLE "DocumentoColaborador" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3) NOT NULL,
    "colaboradorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentoColaborador_pkey" PRIMARY KEY ("id")
);

-- CreateTable: NotificacaoDocumento (log de envios — dedup por constraint única)
CREATE TABLE "NotificacaoDocumento" (
    "id" TEXT NOT NULL,
    "documentoColaboradorId" TEXT NOT NULL,
    "marco" TEXT NOT NULL,
    "enviadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificacaoDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentoColaborador_tipo_dataFim_idx" ON "DocumentoColaborador"("tipo", "dataFim");

-- CreateIndex
CREATE UNIQUE INDEX "NotificacaoDocumento_documentoColaboradorId_marco_key" ON "NotificacaoDocumento"("documentoColaboradorId", "marco");

-- AddForeignKey
ALTER TABLE "Colaborador" ADD CONSTRAINT "Colaborador_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoColaborador" ADD CONSTRAINT "DocumentoColaborador_colaboradorId_fkey"
  FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacaoDocumento" ADD CONSTRAINT "NotificacaoDocumento_documentoColaboradorId_fkey"
  FOREIGN KEY ("documentoColaboradorId") REFERENCES "DocumentoColaborador"("id") ON DELETE CASCADE ON UPDATE CASCADE;
