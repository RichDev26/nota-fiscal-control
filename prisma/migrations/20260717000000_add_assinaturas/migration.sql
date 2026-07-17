-- AlterTable: Usuario ganha CPF/CNPJ (necessário como payer.identification do PIX)
ALTER TABLE "Usuario" ADD COLUMN "cpfCnpj" TEXT;

-- CreateTable: Assinatura (trial + período pago — 1:1 com Usuario)
CREATE TABLE "Assinatura" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TRIAL',
    "trialFimEm" TIMESTAMP(3) NOT NULL,
    "periodoFimEm" TIMESTAMP(3),
    "lembreteEnviadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Cobranca (histórico de cobranças — PIX hoje, outros métodos no futuro via "metodo")
CREATE TABLE "Cobranca" (
    "id" TEXT NOT NULL,
    "assinaturaId" TEXT NOT NULL,
    "metodo" TEXT NOT NULL DEFAULT 'PIX',
    "valor" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "mpPaymentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "qrCode" TEXT,
    "qrCodeBase64" TEXT,
    "expiraEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Assinatura_usuarioId_key" ON "Assinatura"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranca_mpPaymentId_key" ON "Cobranca"("mpPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranca_idempotencyKey_key" ON "Cobranca"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Cobranca_status_idx" ON "Cobranca"("status");

-- AddForeignKey
ALTER TABLE "Assinatura" ADD CONSTRAINT "Assinatura_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobranca" ADD CONSTRAINT "Cobranca_assinaturaId_fkey"
  FOREIGN KEY ("assinaturaId") REFERENCES "Assinatura"("id") ON DELETE CASCADE ON UPDATE CASCADE;
