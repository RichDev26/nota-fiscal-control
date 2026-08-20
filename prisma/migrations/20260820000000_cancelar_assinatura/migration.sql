-- Aditiva: coluna nullable, sem default, sem backfill. Assinaturas existentes
-- ficam com canceladaEm NULL = não canceladas, que é o estado correto.
-- NÃO revoga acesso: temAcessoAtivo() continua decidindo só pelas datas.
ALTER TABLE "Assinatura" ADD COLUMN "canceladaEm" TIMESTAMP(3);
