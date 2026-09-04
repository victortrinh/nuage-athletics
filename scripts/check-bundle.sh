#!/usr/bin/env bash
# JS weight budget for the client bundle. Prints every dist/client/_astro/*.js
# file with its gzip size and fails if the total crosses BUDGET_BYTES.
#
# This isn't a per-page delivery model — a visitor to /acces never loads
# ProductActions.js, and engine.js (the Sky WebGL background) is a lazy
# dynamic import most visits never trigger at all — it's a cheap total
# surface-area number instead, sized to catch what actually moves it: a new
# dependency, an upgraded one, or an island that stopped being lazy. See
# CLAUDE.md's "Component library" note for the measurement this budget was
# set from and why react-aria-components is worth it regardless.
set -euo pipefail
cd "$(dirname "$0")/.."
shopt -s nullglob

DIST=dist/client/_astro
BUDGET_BYTES=130000

if [ ! -d "$DIST" ]; then
  echo "✘ $DIST not found — run npm run build first" >&2
  exit 1
fi

files=("$DIST"/*.js)
if [ ${#files[@]} -eq 0 ]; then
  echo "✘ no .js files under $DIST — did the build actually produce client output?" >&2
  exit 1
fi

total=0
printf '%-55s %10s\n' 'file' 'gzip bytes'
for f in "${files[@]}"; do
  size=$(gzip -c "$f" | wc -c)
  total=$((total + size))
  printf '%-55s %10d\n' "$(basename "$f")" "$size"
done

printf '%-55s %10s\n' '-------------------------------------------------------' '----------'
printf '%-55s %10d\n' 'total' "$total"
echo "budget: $BUDGET_BYTES"

if [ "$total" -gt "$BUDGET_BYTES" ]; then
  echo "✘ client JS is ${total} gzip bytes, over the ${BUDGET_BYTES} budget" >&2
  exit 1
fi
