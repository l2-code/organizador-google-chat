#!/usr/bin/env bash
# Gera o ZIP da extensão para publicar nos Releases.
# Uso: ./build.sh   →   dist/organizador-google-chat.zip
set -euo pipefail
cd "$(dirname "$0")"

NOME="organizador-google-chat.zip"
mkdir -p dist
rm -f "dist/$NOME"

# Só o que o usuário final precisa. O ZIP, ao descompactar, vira a pasta que o
# Chrome carrega em "Carregar sem compactação".
zip -r "dist/$NOME" \
  manifest.json \
  src \
  preset-l2.json \
  README.md \
  -x '*.DS_Store'

echo "Gerado: dist/$NOME"
