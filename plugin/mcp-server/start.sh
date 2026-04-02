#!/bin/sh
cd "$(dirname "$0")"
[ -f node_modules/.package-lock.json ] || npm install --no-fund --no-audit >&2
exec node dist/index.js
