#!/usr/bin/env bash
# shoot.sh — screenshot a running delivery-tracker web page with headless Chrome.
#
# Usage:  ./shoot.sh <url> <out.png>
# Example: ./shoot.sh http://localhost:5173/login /tmp/login.png
#
# Notes (learned the hard way — see SKILL.md Gotchas):
#  * Use http://localhost:5173 (NOT 127.0.0.1) — the API's dev CORS allowlist
#    is exactly http://localhost:5173, so a 127.0.0.1 origin makes every API
#    fetch fail with "Failed to fetch".
#  * The /s/<hash> tracking page renders a MapLibre WebGL map. Headless Chrome
#    has no GPU, so we force software WebGL via SwiftShader (--enable-unsafe-
#    swiftshader + --use-angle=swiftshader). Without it the page shows the
#    "Something went wrong! ... requestedAttributes" WebGL error.
set -euo pipefail

URL="${1:?usage: shoot.sh <url> <out.png>}"
OUT="${2:?usage: shoot.sh <url> <out.png>}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

"$CHROME" --headless=new \
  --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader \
  --hide-scrollbars --window-size=1400,900 --virtual-time-budget=15000 \
  --screenshot="$OUT" "$URL" 2>&1 | grep -iE 'written|error: ' || true

if [ -s "$OUT" ]; then
  echo "wrote $OUT ($(wc -c <"$OUT" | tr -d ' ') bytes)"
else
  echo "screenshot FAILED"; exit 1
fi
