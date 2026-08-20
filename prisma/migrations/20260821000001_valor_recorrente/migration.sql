-- Aditiva: valor com que a assinatura recorrente foi contratada no gateway.
-- Nullable e sem backfill: assinaturas antigas (PIX/avulso) nao tem recorrencia.
-- As faturas sao conferidas contra ESTE valor, nao contra o preco atual do
-- catalogo, para que um reajuste futuro nao recuse faturas de quem ja assinou.
ALTER TABLE "Assinatura" ADD COLUMN "valorRecorrente" DOUBLE PRECISION;
