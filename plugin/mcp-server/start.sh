#!/bin/sh
cd "$(dirname "$0")"
[ -d node_modules/@modelcontextprotocol ] || npm install --no-fund --no-audit >&2
exec node dist/index.js
