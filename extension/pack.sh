#!/bin/zsh
# Builds a Web Store-ready zip (no tests, no dev files).
set -e
cd "$(dirname "$0")"
VER=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/snapask-$VER.zip"
mkdir -p dist && rm -f "$OUT"
zip -qr "$OUT" manifest.json background.js content.js popup.html popup.css popup.js options.html options.css options.js lib icons -x 'icons/icon256.png'
echo "Packed $OUT ($(du -h "$OUT" | cut -f1))"
