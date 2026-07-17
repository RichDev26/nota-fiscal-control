#!/bin/sh
echo "========================================"
echo "[DB] Iniciando setup do banco..."
echo "========================================"

# Garante que o schema PostgreSQL está ativo (o cp do buildCommand pode não persistir)
if [ -f "prisma/schema.postgresql.prisma" ]; then
  echo "[DB] Copiando schema PostgreSQL..."
  cp prisma/schema.postgresql.prisma prisma/schema.prisma
  echo "[DB] Schema PostgreSQL ativado."
else
  echo "[DB] AVISO: schema.postgresql.prisma não encontrado!"
fi

# Tenta migrate deploy primeiro (preserva dados)
echo "[DB] Tentando prisma migrate deploy..."
if npx prisma migrate deploy; then
  echo "[DB] migrate deploy concluido com sucesso."
else
  echo "[DB] migrate deploy FALHOU. Tentando fallback com db push..."
  npx prisma db push --accept-data-loss || {
    echo "[DB] db push tambem falhou. Continuando mesmo assim..."
  }
fi

echo "========================================"
echo "[DB] Rodando backfill de assinaturas (idempotente — seguro rodar em todo start)..."
echo "========================================"
npx tsx scripts/backfill-assinaturas.ts || echo "[DB] AVISO: backfill de assinaturas falhou. Não bloqueia o start."

echo "========================================"
echo "[APP] Iniciando Next.js..."
echo "========================================"
exec npm start
