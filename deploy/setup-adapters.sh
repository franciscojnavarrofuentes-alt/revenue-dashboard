#!/usr/bin/env bash
# Descarga los adapters de DefiLlama en vendor/ fijados a un commit probado.
# Para actualizar: cambia ADAPTERS_COMMIT y vuelve a ejecutar.
set -euo pipefail

ADAPTERS_COMMIT="${ADAPTERS_COMMIT:-baafc1643877700d8e373c5b0b9afa7b39e009bf}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor/dimension-adapters"

if [ ! -d "$DIR/.git" ]; then
  mkdir -p "$(dirname "$DIR")"
  git clone --filter=blob:none https://github.com/DefiLlama/dimension-adapters.git "$DIR"
fi
cd "$DIR"
git fetch --quiet origin
git checkout --quiet "$ADAPTERS_COMMIT"
npm install --no-audit --no-fund
echo "Adapters listos en $DIR ($(git rev-parse --short HEAD))"
