#!/bin/sh
cd "$(dirname "$0")"
[ -f node_modules/@modelcontextprotocol/sdk/dist/esm/index.js ] || npm install --no-fund --no-audit >&2

# Rebuild better-sqlite3 if the native binary doesn't match the current Node arch.
# This prevents ABI/architecture mismatches when npm install was run under a different
# Node (e.g. arm64 nvm) than the one that will exec this server.
# Note: process.arch returns "x64" for x86_64, so we normalise before comparing.
_node_arch=$(node -e "var a=process.arch; process.stdout.write(a==='x64'?'x86_64':a)")
_sqlite_node="node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if [ -f "$_sqlite_node" ]; then
  _bin_arch=$(file "$_sqlite_node" | grep -o 'arm64\|x86_64' | head -1)
  if [ -n "$_bin_arch" ] && [ "$_bin_arch" != "$_node_arch" ]; then
    echo "[mcp] rebuilding better-sqlite3 for $_node_arch (was $_bin_arch)" >&2
    npm rebuild better-sqlite3 --no-fund --no-audit >&2
  fi
fi

[ -f dist/index.js ] || npm run build >&2
exec node dist/index.js
