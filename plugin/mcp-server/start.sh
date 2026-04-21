#!/bin/sh
cd "$(dirname "$0")"
[ -f node_modules/@modelcontextprotocol/sdk/dist/esm/index.js ] || npm install --no-fund --no-audit >&2
[ -f dist/index.js ] || npm run build >&2
exec node dist/index.js
