#!/bin/sh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$ROOT/plugin"
MCP="$PLUGIN/mcp-server"

# Read version from plugin.json
VERSION=$(grep '"version"' "$PLUGIN/.claude-plugin/plugin.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
BUNDLE="$ROOT/obsidian-productivity-v${VERSION}.plugin"

echo "Building obsidian-productivity v${VERSION}..."

# 1. Install all dependencies (need devDeps for tsc)
echo "Installing dependencies..."
cd "$MCP"
npm install --no-fund --no-audit

# 2. Build TypeScript
echo "Compiling TypeScript..."
npm run build

# 3. Prune to production-only deps for the bundle
echo "Pruning dev dependencies..."
npm prune --omit=dev --no-fund --no-audit

# 4. Create bundle (zip from plugin/ directory)
echo "Creating bundle..."
cd "$PLUGIN"
rm -f "$BUNDLE"
zip -r "$BUNDLE" \
  .claude-plugin/ \
  .mcp.json \
  commands/ \
  skills/ \
  mcp-server/dist/ \
  mcp-server/node_modules/ \
  mcp-server/package.json \
  mcp-server/package-lock.json \
  mcp-server/start.sh \
  CONNECTORS.md \
  -x '*.DS_Store' \
  -x 'mcp-server/node_modules/.cache/*'

echo ""
echo "Done: $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"
