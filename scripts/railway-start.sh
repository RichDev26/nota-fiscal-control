#!/bin/sh
echo "========================================"
echo "[DB] Iniciando setup do banco..."
echo "========================================"

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
echo "[APP] Iniciando Next.js..."
echo "========================================"
exec npm start
