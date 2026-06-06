-- Migration inicial — usa IF NOT EXISTS para ser segura tanto em
-- bancos novos (cria as tabelas) quanto em bancos existentes
-- (ignora se as tabelas já foram criadas pelo prisma db push).

-- CreateTable
CREATE TABLE IF NOT EXISTS "PessoaFiscal" (
    "id" TEXT NOT NULL,
    "nomeRazaoSocial" TEXT,
    "nomeFantasia" TEXT,
    "cpfCnpj" TEXT,
    "endereco" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cep" TEXT,
    "municipio" TEXT,
    "uf" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "celular" TEXT,
    "inscricaoMunicipal" TEXT,
    "inscricaoEstadual" TEXT,
    "site" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PessoaFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NotaFiscal" (
    "id" TEXT NOT NULL,
    "nomeOrganizador" TEXT,
    "tipo" TEXT,
    "numeroNf" TEXT,
    "numeroRps" TEXT,
    "codigoVerificacao" TEXT,
    "of" TEXT,
    "descricao" TEXT,
    "dataEmissao" TIMESTAMP(3),
    "dataFatoGerador" TIMESTAMP(3),
    "dataVencimento" TIMESTAMP(3),
    "dataRecebimento" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "valorBruto" DOUBLE PRECISION,
    "valorLiquido" DOUBLE PRECISION,
    "aliquota" DOUBLE PRECISION,
    "valorIss" DOUBLE PRECISION,
    "baseCalculo" DOUBLE PRECISION,
    "valorLiquidoAntecipacao" DOUBLE PRECISION,
    "valorTotalTributosAntecipacao" DOUBLE PRECISION,
    "ir" DOUBLE PRECISION,
    "pisPasep" DOUBLE PRECISION,
    "cofins" DOUBLE PRECISION,
    "inss" DOUBLE PRECISION,
    "csll" DOUBLE PRECISION,
    "outrasRetencoes" DOUBLE PRECISION,
    "valorAproximadoTributos" DOUBLE PRECISION,
    "naturezaOperacao" TEXT,
    "situacaoTributariaIssqn" TEXT,
    "localPrestacao" TEXT,
    "situacaoNfse" TEXT,
    "observacoesFiscais" TEXT,
    "regimeTributario" TEXT,
    "indicacaoRetencao" TEXT,
    "observacoesAutenticidade" TEXT,
    "municipioEmissor" TEXT,
    "codigoServico" TEXT,
    "quantidade" DOUBLE PRECISION,
    "valorUnitario" DOUBLE PRECISION,
    "observacoes" TEXT,
    "arquivoPdfUrl" TEXT,
    "pdfData" TEXT,
    "tags" TEXT,
    "prestadorId" TEXT,
    "tomadorId" TEXT,
    "notaSubstitutivaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotaFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Imposto" (
    "id" TEXT NOT NULL,
    "mesReferencia" TEXT,
    "dataVencimento" TIMESTAMP(3),
    "dataPagamento" TIMESTAMP(3),
    "imposto" TEXT,
    "valor" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "observacao" TEXT,
    "notaFiscalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Imposto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "HistoricoAlteracao" (
    "id" TEXT NOT NULL,
    "notaFiscalId" TEXT NOT NULL,
    "campoAlterado" TEXT,
    "valorAntigo" TEXT,
    "valorNovo" TEXT,
    "usuario" TEXT,
    "dataAcao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HistoricoAlteracao_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey (ignora se já existe)
DO $$ BEGIN
  ALTER TABLE "NotaFiscal" ADD CONSTRAINT "NotaFiscal_prestadorId_fkey"
    FOREIGN KEY ("prestadorId") REFERENCES "PessoaFiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NotaFiscal" ADD CONSTRAINT "NotaFiscal_tomadorId_fkey"
    FOREIGN KEY ("tomadorId") REFERENCES "PessoaFiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NotaFiscal" ADD CONSTRAINT "NotaFiscal_notaSubstitutivaId_fkey"
    FOREIGN KEY ("notaSubstitutivaId") REFERENCES "NotaFiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Imposto" ADD CONSTRAINT "Imposto_notaFiscalId_fkey"
    FOREIGN KEY ("notaFiscalId") REFERENCES "NotaFiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "HistoricoAlteracao" ADD CONSTRAINT "HistoricoAlteracao_notaFiscalId_fkey"
    FOREIGN KEY ("notaFiscalId") REFERENCES "NotaFiscal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
