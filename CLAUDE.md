# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An Obsidian-native productivity plugin for Claude Desktop, Cowork, and Claude Code. It combines task management, workplace memory, and Obsidian-flavored markdown skills — everything lives in the user's vault as linked, searchable notes. Includes an MCP server for vault operations.

## Build Commands

```bash
cd mcp-server
npm install        # install dependencies
npm run build      # compile TypeScript (tsc → dist/)
npm run dev        # run from source with tsx
npm start          # run compiled dist/index.js
```

There are no tests or linting configured in this project.

## Architecture

### MCP Server (`mcp-server/`)

A TypeScript MCP server using `@modelcontextprotocol/sdk` with stdio transport. Single entry point at `src/index.ts` that registers all 23 tools grouped by domain:

- **Tool modules** (`src/tools/`) — each file exports pure functions that take `vaultPath` as first arg and return plain objects (JSON-serializable). `index.ts` wraps each in `server.tool()` with Zod schemas.
- **Core utilities** (`src/`) — `vault.ts` (path resolution, directory ops, path traversal prevention), `frontmatter.ts` (gray-matter parse/serialize, section replacement, frontmatter filtering), `wikilinks.ts` (extract/consolidate/validate wikilinks).

Vault path resolution priority: CLI arg → `OBSIDIAN_VAULT_PATH` env var → CWD.

### Skills (`skills/`)

Each skill is a folder with a `SKILL.md` and optional `references/` subdirectory. Skills are markdown-based prompt definitions — not code. They teach Claude how to work with specific Obsidian features (markdown syntax, bases, canvas, CLI, task management, memory, etc.).

### Commands (`commands/`)

Markdown files defining the `/vault-init`, `/start`, and `/update` command prompts. These orchestrate vault setup and maintenance workflows.

### Connectors (`.mcp.json`, `CONNECTORS.md`)

The `.mcp.json` pre-configures MCP servers for external tools (Slack, Notion, Asana, Linear, Gmail, Google Calendar, etc.). Plugin files use `~~category` placeholders (e.g., `~~chat`, `~~project tracker`) to stay tool-agnostic.

### Plugin Distribution

The plugin uses the `.claude-plugin/plugin.json` manifest format, shared by both Cowork and Claude Code. The repo also contains a `.claude-plugin/marketplace.json` so it can serve as its own Claude Code marketplace.

- **Cowork**: Install via the plugin UI, or use `.plugin` bundle files (zip archives containing manifest, skills, commands, `.mcp.json`, and MCP server)
- **Claude Code (terminal & VS Code extension)**: Add the repo as a marketplace (`/plugin marketplace add semantechs/obsidian-productivity`), then install via `/plugin install obsidian-productivity`. This registers all skills, commands, and MCP tools. Requires `OBSIDIAN_VAULT_PATH` env var for vault path resolution.
- **Claude Desktop**: MCP server only (no skill/command auto-discovery) — configure in `claude_desktop_config.json`

`obsidian-productivity-v*.plugin` files are versioned distribution bundles for Cowork.

## Key Patterns

- All vault operations go through the MCP tools — never direct filesystem access from skills/commands.
- Frontmatter is parsed with `gray-matter` and filtered with `matchesFrontmatter()` which supports equality, array containment, and substring matching.
- Wikilinks follow `[[filename-slug|Display Name]]` canonical format. The consolidation system collects aliases and rewrites variants vault-wide.
- Tasks are individual `.md` files in `tasks/` with frontmatter (status, priority, due, context). Completed tasks move to `tasks/done/`.
- Memory is a two-tier system: people/projects/context as individual notes in `memory/`, plus a `CLAUDE.md` hot-cache at vault root.
