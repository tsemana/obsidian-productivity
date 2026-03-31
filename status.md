# Obsidian Productivity Plugin — Status

**Last updated:** 2026-03-30
**Version:** 0.9.0 (on `main`, pushed to `tsemana/obsidian-productivity`)
**Build:** Clean (`tsc` compiles with no errors)

---

## Architecture Overview

An Obsidian-native productivity plugin for Claude Code, Cowork, and Claude Desktop. Everything lives in the user's vault as linked, searchable markdown notes. An MCP server provides 36 tools for vault operations, and skills/commands teach Claude productivity workflows.

**Key decision:** Flat `.md` files remain source of truth. SQLite (`.vault-index.db`) is a read-optimized sidecar index — gitignored, auto-rebuilt from vault files if deleted. See [architecture-recommendation.md](docs/architecture-recommendation.md) for full rationale.

---

## What's Been Built

### Phase 1 — Complete (SP1 + SP2)

Phase 1 of the architecture roadmap is fully implemented across two sub-projects:

#### SP1: SQLite Foundation + Google Auth (PR #3, merged)

Spec: [docs/superpowers/specs/2026-03-29-sp1-sqlite-foundation-google-auth-design.md](docs/superpowers/specs/2026-03-29-sp1-sqlite-foundation-google-auth-design.md)
Plan: [docs/superpowers/plans/2026-03-29-sp1-sqlite-foundation-google-auth.md](docs/superpowers/plans/2026-03-29-sp1-sqlite-foundation-google-auth.md)

| Component | File | Status |
|-----------|------|--------|
| SQLite connection manager + schema + migrations | `plugin/mcp-server/src/index-db.ts` | Done |
| Vault scanner + incremental sync + single-file re-index | `plugin/mcp-server/src/sync.ts` | Done |
| Google Calendar + Gmail REST clients via gcloud CLI | `plugin/mcp-server/src/google-api.ts` | Done |
| HTTP sidecar (radar sync/update endpoints) | `plugin/mcp-server/src/http-sidecar.ts` | Done |
| `account_register`, `account_sync` MCP tools | `plugin/mcp-server/src/tools/external.ts` | Done |
| `radar_generate`, `radar_update_item` MCP tools | `plugin/mcp-server/src/tools/radar.ts` | Done |
| Refactored `noteSearch` → FTS5 | `plugin/mcp-server/src/tools/notes.ts` | Done |
| Refactored `taskList` → SQLite + re-index hooks | `plugin/mcp-server/src/tools/tasks.ts` | Done |
| Refactored `memoryRead` → FTS5 + re-index hooks | `plugin/mcp-server/src/tools/memory.ts` | Done |
| Refactored `wikilinkValidate` → SQLite + sync trigger | `plugin/mcp-server/src/tools/wikilink-tools.ts` | Done |
| `better-sqlite3` dependency + `dist/` committed | `plugin/mcp-server/package.json` | Done |
| `inbox/`, `memory/areas/` vault directories | `plugin/mcp-server/src/vault.ts` | Done |

#### SP2: Composite Tools, Skills & Commands, Cron (PR #4, merged)

Spec: [docs/superpowers/specs/2026-03-30-sp2-composite-tools-skills-cron-design.md](docs/superpowers/specs/2026-03-30-sp2-composite-tools-skills-cron-design.md)
Plan: [docs/superpowers/plans/2026-03-30-sp2-composite-tools-skills-cron.md](docs/superpowers/plans/2026-03-30-sp2-composite-tools-skills-cron.md)

| Component | File | Status |
|-----------|------|--------|
| 5 composite tools: `radar_data`, `weekly_review`, `project_overview`, `quick_capture`, `search_and_summarize` | `plugin/mcp-server/src/tools/composite.ts` | Done |
| Composite tools registered in index (Group 10) | `plugin/mcp-server/src/index.ts` | Done |
| `radarGenerate` refactored to call `radarData` + daily note generation | `plugin/mcp-server/src/tools/radar.ts` | Done |
| Daily-radar skill: `radar_data` preferred path, next actions, inbox badge, waiting-for escalation, stuck projects | `plugin/skills/daily-radar/SKILL.md` | Done |
| `/review` command (GTD Weekly Review, 7 steps) | `plugin/commands/review.md` | Done |
| Inbox-capture skill (two-speed capture model) | `plugin/skills/inbox-capture/SKILL.md` | Done |
| Cron setup in `/start` command | `plugin/commands/start.md` | Done |

#### Post-merge fixes (directly on `main`)

| Commit | Fix |
|--------|-----|
| `5d01c45` | Coerce frontmatter `Date` objects to strings for SQLite binding |
| `be1d7ba` | Commit `dist/` so plugin installs without a build step |
| `8774e92` | Update install instructions — `npm install` needed for native SQLite module |
| `426d922` | Bump `marketplace.json` version to 0.9.0 |

#### SP3: Native OAuth2 for Google Calendar & Gmail APIs (`feature/sp3-native-oauth-google-apis`)

| Component | File | Status |
|-----------|------|--------|
| Varlock .env.schema (exec + 1Password CLI + macOS Keychain) | `plugin/mcp-server/.env.schema` | Done |
| OAuth2 flow module (consent URL, callback server, token exchange/refresh) | `plugin/mcp-server/src/google-oauth.ts` | Done |
| Schema migration V2 (refresh_token column) | `plugin/mcp-server/src/index-db.ts` | Done |
| getAccessToken: OAuth2 refresh tokens with gcloud fallback | `plugin/mcp-server/src/google-api.ts` | Done |
| accountRegister: browser OAuth flow, re-registration support | `plugin/mcp-server/src/tools/external.ts` | Done |
| `open` + `varlock` dependencies | `plugin/mcp-server/package.json` | Done |

**Verified:** All 4 accounts (personal, vetsource, semantechs, kogarashi) syncing calendar events and emails via native OAuth2. `radar_data` returns `sources_available: { vault: true, calendar: true, email: true }`.

### Inventory

| Category | Count | Details |
|----------|-------|---------|
| MCP tools | 32 | 23 original (4 refactored in-place for SQLite) + 4 SP1 new + 5 SP2 composite |
| Skills | 12 | task-management, memory-management, vault-workflow, obsidian-markdown, obsidian-bases, json-canvas, obsidian-cli, consolidate-on, defuddle, transcript-capture, daily-radar, inbox-capture |
| Commands | 4 | `/vault-init`, `/start`, `/update`, `/review` |
| Distribution | 3 channels | Claude Code (marketplace), Cowork (`.plugin` bundle), Claude Desktop (MCP only) |

---

## Distribution Status

### Claude Code (marketplace install)

```
/plugin marketplace add tsemana/obsidian-productivity
/plugin install obsidian-productivity
```

**Status: VERIFIED (2026-03-30)** — marketplace install works end-to-end. All components confirmed functional.

Verification checklist:
- [x] Skills appear in `/` menu (12 skills)
- [x] Commands appear in `/` menu (4 commands)
- [x] MCP tools are registered — **32 tools** (not 36; see note below)
- [x] `OBSIDIAN_VAULT_PATH` env var is respected — `vault_health` returned 152 notes from the configured vault
- [x] `npm install` in `plugin/mcp-server/` — works (server starts and responds to stdio)
- [x] `better-sqlite3` native module compiles — confirmed via `note_search` FTS5 query returning results

**Tool count discrepancy:** status.md previously claimed 36 tools (27 original + 4 SP1 + 5 SP2), but `tools/list` returns **32**. The 4 refactored tools (noteSearch, taskList, memoryRead, wikilinkValidate) were replaced in-place rather than added as new tools, so the correct count is 32.

**Known issue:** MCP servers `google-calendar` and `gmail` from plugin are skipped when user already has `claude.ai Google Calendar` / `claude.ai Gmail` configured at account level. This is expected — the account-level servers take precedence. Suggestion in plugin output: "Remove 'claude.ai Google Calendar' from your MCP config if you want the plugin's version instead."

### Cowork (`.plugin` bundle)

**Status: STALE** — `obsidian-productivity-v0.6.5.plugin` is from the pre-restructure, pre-SQLite era. Needs a fresh bundle built from `plugin/` at v0.9.0.

### Claude Desktop (MCP server config)

**Status: SHOULD WORK** — configure `plugin/mcp-server` in `claude_desktop_config.json`. No skill/command auto-discovery, but all 36 MCP tools should register. The `npm install` requirement for `better-sqlite3` applies here too.

---

## What's NOT Built Yet

### Phase 2: Polish + Auto-Maintenance (from architecture roadmap)

| Task | Details | Priority |
|------|---------|----------|
| Auto-maintain CLAUDE.md hot cache | Regenerate from `reference_log` frequency — top 30 people/terms/projects | Medium |
| Calendar/email cache maturation | Freshness indicators, per-account sync status, graceful API failure handling | Medium |
| Archive workflow | Completed projects → `memory/projects/archive/`. Auto-archive daily notes >90 days | Low |
| Glossary indexing | Parse `glossary.md` tables into SQLite on startup | Low |
| Inbox processing UX | Structured walkthrough during `/review` with batch approval | Low |
| File watcher | `chokidar` for re-indexing on external file changes | Low |

### Phase 3: Semantic Intelligence (deferred until vault >2K notes)

| Task | Details |
|------|---------|
| sqlite-vec extension | Vector storage in `.vault-index.db` |
| Ollama integration | Embed with `nomic-embed-text` (768 dims, local, free) |
| Heading-level chunking | Split at `##` boundaries, embed each chunk |
| `semantic_search` tool | Hybrid FTS5 + vector cosine similarity |
| Related notes suggestions | Surface semantically similar notes |
| Proactive surfacing | "Project Phoenix has had no activity in 2 weeks" |

---

## Next Steps (Recommended Order)

1. **Test Claude Code install flow** — run the marketplace install commands and work through the verification checklist above. This is the highest priority since it blocks real-world usage.

2. **Rebuild Cowork bundle** — create `obsidian-productivity-v0.9.0.plugin` from the `plugin/` directory so Cowork users get the SQLite + composite tools.

3. **Clean up untracked files** — decide on `.claude/`, `.superpowers/`, `docs/`, `status.md`:
   - `docs/` contains architecture docs and implementation plans — likely worth committing
   - `.claude/`, `.superpowers/` are local workspace artifacts — likely gitignore
   - `status.md` — this file; gitignore or commit as project documentation

4. **User acceptance testing** — exercise the full workflow in a real vault: `/vault-init` → `/start` → daily radar → inbox capture → `/review`. Especially test the SQLite indexing, FTS5 search, and composite tool performance.

5. **Phase 2 items** — pick up auto-CLAUDE.md maintenance or calendar cache maturation based on real usage friction.

---

## Key Files

| File | Purpose |
|------|---------|
| `.claude-plugin/marketplace.json` | Marketplace catalog for Claude Code |
| `plugin/.claude-plugin/plugin.json` | Plugin manifest (v0.9.0) |
| `plugin/.mcp.json` | MCP server + external connector configs |
| `plugin/mcp-server/` | TypeScript MCP server (36 tools) |
| `plugin/skills/` | 12 skill definitions |
| `plugin/commands/` | 4 command prompts |
| `docs/architecture-recommendation.md` | Architecture decision document |
| `docs/superpowers/specs/` | SP1 + SP2 design specifications |
| `docs/superpowers/plans/` | SP1 + SP2 implementation plans |

---

## Reference: Git History Summary

| Merge/Commit | What |
|-------------|------|
| `5681a76` | Initial commit |
| PR #1 | XSS fix in board view |
| PR #2 | Individual task notes (v0.5.0) |
| `1d1107d` | Consolidate-on skill + canonical wikilinks (v0.6.4) |
| `53f220f`–`dd40e0b` | MCP server + marketplace restructure (v0.7.0) |
| PR #3 | SP1: SQLite foundation + Google auth (v0.8.0) |
| PR #4 | SP2: Composite tools, skills, commands, cron (v0.9.0) |
| `5d01c45`–`8774e92` | Post-merge fixes (Date coercion, dist/, install docs, marketplace version) |
