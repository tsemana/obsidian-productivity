# SP1: SQLite Foundation + Google Auth

**Date:** 2026-03-29
**Status:** Design approved
**Parent:** [Architecture Recommendation](../../architecture-recommendation.md)
**Scope:** Sub-project 1 of 2 (Approach C — parallel tracks sharing one SQLite database)

---

## 1. Goal

Deliver the data foundation that all future composite tools, radar enhancements, and workflow commands depend on:

- **Track A:** SQLite sidecar index with FTS5 full-text search, wikilink graph, and incremental vault sync.
- **Track B:** Multi-account Google Calendar + Gmail access via gcloud CLI, cached in the same SQLite database.
- **Cross-cutting:** HTTP sidecar for radar interactivity, radar generation/update tools, write-path re-indexing.

## 2. Boundaries

### In scope

- SQLite schema, connection manager, migrations (`index-db.ts`)
- Vault scanner and incremental re-indexer (`sync.ts`)
- Refactor 4 existing tools to use indexed queries: `noteSearch`, `taskList`, `memoryRead`, `wikilinkValidate`
- Write-path re-index hooks on: `taskCreate`, `taskUpdate`, `taskComplete`, `memoryWrite`, `noteWrite`, `wikilinkConsolidate`
- Google Calendar + Gmail REST clients via gcloud token acquisition (`google-api.ts`)
- `account_register`, `account_sync` MCP tools (`tools/external.ts`)
- `radar_generate`, `radar_update_item` MCP tools (`tools/radar.ts`)
- HTTP sidecar for radar sync button and strikethrough updates (`http-sidecar.ts`)
- Add `inbox/` and `memory/areas/` to `VAULT_DIRECTORIES`

### Out of scope (SP2)

- Composite workflow tools (`radar_data`, `weekly_review`, `project_overview`, `quick_capture`, `search_and_summarize`)
- Daily-radar skill modifications (next actions, inbox badge, stuck project detection)
- `/review` command, inbox-capture skill
- Cron-based automated radar generation

### Out of scope (Phase 3)

- RAG / semantic search (sqlite-vec + Ollama)

## 3. SQLite Schema

**Database file:** `.vault-index.db` at vault root. Gitignored. Auto-rebuilt from vault files if deleted or corrupt.

### 3.1 Vault Index Tables

```sql
CREATE TABLE notes (
  path TEXT PRIMARY KEY,
  title TEXT,
  tags TEXT,                -- JSON array
  status TEXT,
  priority TEXT,
  due TEXT,
  context TEXT,
  project TEXT,
  assigned_to TEXT,
  area TEXT,
  created TEXT,
  modified_at INTEGER,      -- file mtime (epoch ms)
  content_hash TEXT,         -- SHA-256 of file content
  body_preview TEXT,         -- first 500 chars of body
  frontmatter_json TEXT      -- full frontmatter as JSON
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body,
  content='',               -- external content mode
  tokenize='porter unicode61'
);

CREATE TABLE wikilinks (
  source_path TEXT,
  target_slug TEXT,
  display_text TEXT,
  PRIMARY KEY (source_path, target_slug, display_text),
  FOREIGN KEY (source_path) REFERENCES notes(path) ON DELETE CASCADE
);

CREATE TABLE reference_log (
  path TEXT,
  referenced_at INTEGER,
  context TEXT               -- 'search', 'briefing', 'review', 'manual'
);
```

### 3.2 External Data Cache Tables

```sql
CREATE TABLE external_accounts (
  id TEXT PRIMARY KEY,            -- user-chosen label: "work", "personal", etc.
  provider TEXT NOT NULL DEFAULT 'google',
  account_email TEXT NOT NULL,
  context TEXT,                   -- 'work' or 'personal'
  last_synced_at INTEGER
);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,            -- Google event ID
  account_id TEXT REFERENCES external_accounts(id),
  calendar_id TEXT,
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,       -- ISO 8601
  end_time TEXT,
  all_day INTEGER DEFAULT 0,
  attendees TEXT,                 -- JSON array
  location TEXT,
  description TEXT,
  html_link TEXT,
  rsvp_status TEXT,
  synced_at INTEGER
);

CREATE TABLE email_cache (
  id TEXT PRIMARY KEY,            -- Gmail message ID
  account_id TEXT REFERENCES external_accounts(id),
  thread_id TEXT,
  subject TEXT,
  sender TEXT,
  date TEXT,
  labels TEXT,                    -- JSON array
  snippet TEXT,
  is_starred INTEGER DEFAULT 0,
  is_important INTEGER DEFAULT 0,
  html_link TEXT,
  synced_at INTEGER
);
```

### 3.3 Indexes

```sql
CREATE INDEX idx_notes_status ON notes(status);
CREATE INDEX idx_notes_due ON notes(due);
CREATE INDEX idx_notes_context ON notes(context);
CREATE INDEX idx_notes_project ON notes(project);
CREATE INDEX idx_wikilinks_target ON wikilinks(target_slug);
CREATE INDEX idx_calendar_time ON calendar_events(start_time);
CREATE INDEX idx_calendar_account ON calendar_events(account_id);
CREATE INDEX idx_email_date ON email_cache(date);
CREATE INDEX idx_email_account ON email_cache(account_id);
CREATE INDEX idx_reflog_path ON reference_log(path, referenced_at);
```

### 3.4 Migration Strategy

Schema versioning via `PRAGMA user_version`. On startup, check version and run needed migrations sequentially. V1 = full schema above.

## 4. Connection Manager (`index-db.ts`)

- Singleton pattern: one `better-sqlite3` connection per MCP server process
- WAL mode for concurrent reads during sync
- On startup: open/create DB, run migrations, return connection
- If DB is corrupt: delete and rebuild (full vault scan is sub-second)
- Exports: `openDatabase(vaultPath)`, `getDatabase()`, `closeDatabase()`
- Query helpers for common patterns (prepared statements, transaction wrappers)

## 5. Vault Scanner & Incremental Sync (`sync.ts`)

### 5.1 Full Scan

Runs on first boot or DB rebuild:

1. Walk all `.md` files in vault recursively
2. Parse each with `gray-matter` (reusing `frontmatter.ts`)
3. Extract wikilinks (reusing `wikilinks.ts`)
4. Batch insert into `notes`, `notes_fts`, `wikilinks` inside a transaction

### 5.2 Incremental Sync

Runs on every subsequent startup:

1. Walk all `.md` files, collect `{ path, mtime }`
2. Compare against `notes.modified_at` in SQLite
3. For each file:
   - **New** (path not in DB): parse, insert into all 3 tables
   - **Modified** (mtime differs): parse, compute SHA-256 — if `content_hash` changed, update all 3 tables; if hash matches, update only `modified_at`
   - **Deleted** (in DB but not on disk): delete from all 3 tables (CASCADE handles wikilinks)
4. Entire operation in a single transaction

### 5.3 Single-File Re-index

Called by write-path tools after modifying a file:

1. Parse the written file
2. Upsert into `notes` and `notes_fts`
3. Delete + re-insert `wikilinks` for that `source_path`

### 5.4 Performance

- Full scan: ~5,000 notes/sec (sub-second for typical vaults)
- Incremental sync: under 100ms (most files unchanged)
- Non-blocking: MCP server accepts tool calls immediately; queries against stale data are acceptable during the brief sync window

### 5.5 Indexed Fields

| Source | SQLite column |
|--------|---------------|
| File path | `notes.path` (PK) |
| `frontmatter.title` | `notes.title` |
| `frontmatter.tags` | `notes.tags` (JSON array) |
| `frontmatter.status` | `notes.status` |
| `frontmatter.priority` | `notes.priority` |
| `frontmatter.due` | `notes.due` |
| `frontmatter.context` | `notes.context` |
| `frontmatter.project` | `notes.project` |
| `frontmatter.assigned-to` | `notes.assigned_to` |
| `frontmatter.area` | `notes.area` |
| `frontmatter.created` | `notes.created` |
| File mtime | `notes.modified_at` |
| SHA-256 of raw content | `notes.content_hash` |
| First 500 chars of body | `notes.body_preview` |
| Full frontmatter as JSON | `notes.frontmatter_json` |
| Full body text | `notes_fts.body` (search only) |
| Each `[[target\|display]]` | `wikilinks` row |

## 6. Existing Tool Refactoring

Function signatures and return shapes do not change. Only internals switch from O(n) file reads to indexed queries.

### 6.1 `noteSearch` (notes.ts)

- Text query: FTS5 `MATCH` with `bm25()` ranking
- Frontmatter filter: SQL `WHERE` on indexed columns; `LIKE` on `frontmatter_json` for non-indexed fields
- Still respects `directory`, `extension`, `limit` parameters
- Return shape unchanged: `{ results: [{ path, frontmatter, matches }], count }`

### 6.2 `taskList` (tasks.ts)

- All filters become `WHERE` clauses: `status`, `priority`, `context`, `project`, `assigned_to`, `due_before`, `due_after`
- `include_done`: includes `path LIKE 'tasks/done/%'`
- `body_preview` from indexed column (no file read for listing)
- Return shape unchanged: `{ tasks: [{ path, frontmatter, body_preview }], count }`

### 6.3 `memoryRead` (memory.ts)

- Search mode: FTS5 on title + body, scoped to `path LIKE 'memory/%'`
- Type filter: path prefix — `memory/people/%`, `memory/projects/%`, `memory/context/%`, `memory/areas/%`
- Direct path mode unchanged (reads file for full content)
- Return shape unchanged

### 6.4 `wikilinkValidate` (wikilink-tools.ts)

- Known targets: `SELECT path, title, frontmatter_json FROM notes` (extract aliases from JSON)
- All wikilinks: `SELECT * FROM wikilinks`
- Comparison and fuzzy suggestions computed in-memory (same logic, faster data access)
- Return shape unchanged: `{ broken_links: [{ source_path, link_text, suggestions }], count }`

### 6.5 Write-Path Re-index Hooks

These tools trigger single-file re-index after writing:

- `taskCreate`, `taskUpdate`, `taskComplete`
- `memoryWrite`
- `noteWrite`

`wikilinkConsolidate` writes to many files and triggers a full incremental sync after completion.

### 6.6 Backward Compatibility

Refactored tools accept an optional `db` parameter. If absent, they fall back to file-scan behavior. This supports testing and graceful degradation if SQLite is unavailable.

## 7. Google Auth via gcloud CLI

### 7.1 Prerequisites

User has `gcloud` CLI installed and authenticated to each Google account:

```bash
gcloud auth login work@company.com
gcloud auth login me@gmail.com
gcloud auth login account3@gmail.com
gcloud auth login account4@gmail.com
```

No Google Cloud project required. No `.env.schema` for Google credentials.

### 7.2 Token Acquisition

At sync time, the MCP server gets a fresh access token per account:

```bash
gcloud auth print-access-token --account=EMAIL
```

Called via `child_process.execSync`. Token held in memory only, used for API calls, then discarded. No token caching, no refresh logic — gcloud handles all of that internally (credentials stored in macOS Keychain via `~/.config/gcloud/`).

### 7.3 Credential Security

- No tokens stored in SQLite, `.env` files, or anywhere on disk by this system
- gcloud manages its own credential store (macOS Keychain-backed)
- Access tokens are ephemeral (in-memory, ~1hr TTL)
- The `external_accounts` table stores only: id, email, context, provider, last_synced_at

## 8. Google API Clients (`google-api.ts`)

### 8.1 Calendar Client

- REST v3 API via Node's built-in `fetch`
- `GET /calendars/{calendarId}/events`
- Time window: 7 days back + 14 days forward (configurable)
- Handles pagination (`nextPageToken`)
- Timezone-aware (pass `timeZone` to API, no manual UTC conversion)
- Upserts into `calendar_events` by Google event ID
- Deletes cached events no longer returned by API (cancelled/removed)

### 8.2 Gmail Client

- REST v1 API via Node's built-in `fetch`
- `GET /messages?q=is:unread (is:important OR is:starred)` (configurable query)
- Fetches message details in batches
- Upserts into `email_cache` by Gmail message ID
- Prunes cache entries older than 30 days

### 8.3 No SDK Dependency

All Google API calls use `fetch`. No `googleapis` npm package.

## 9. New MCP Tools

### 9.1 `account_register` (tools/external.ts)

```
Input:  { id: string, email: string, context?: "work" | "personal" }
```

1. Verify account is authenticated: `gcloud auth print-access-token --account=EMAIL`
2. If fails, return error prompting user to run `gcloud auth login EMAIL`
3. Insert row into `external_accounts`
4. Return: `{ id, email, context, message }`

### 9.2 `account_sync` (tools/external.ts)

```
Input:  { id?: string }  // omit to sync all accounts
```

1. Look up account(s) in `external_accounts`
2. For each: get token via gcloud, call Calendar + Gmail APIs, upsert cache
3. Update `last_synced_at`
4. Return: `{ accounts: [{ id, calendar_events_synced, emails_synced, last_synced_at }] }`
5. Per-account failure isolation: one expired token doesn't block others

### 9.3 `radar_generate` (tools/radar.ts)

```
Input:  { date?: string }  // defaults to today
```

1. Call `account_sync` (sync-on-demand model)
2. Query SQLite for: tasks (active, overdue, waiting), calendar events (today + lookahead), email highlights, vault context (CLAUDE.md)
3. Render HTML using the daily-radar design system (CSS tokens, layout, and visual structure ported from `plugin/skills/daily-radar/SKILL.md` into the tool's HTML template)
4. Write to `radar-YYYY-MM-DD.html` (overwrites if exists)
5. Embed HTTP sidecar port in `<meta name="radar-port">` tag
6. Each radar item gets a `data-task-path` attribute for strikethrough targeting
7. Re-sync button wired to `POST http://localhost:{port}/sync`
8. Return: `{ path, tasks_count, events_count, emails_count }`

### 9.4 `radar_update_item` (tools/radar.ts)

```
Input:  { path: string, state: "resolved" | "active" }
```

1. Read current radar HTML file (`radar-YYYY-MM-DD.html`)
2. Find element by `data-task-path` attribute matching `path`
3. If `state: "resolved"`: wrap content in `<s class="resolved">`, add `opacity: 0.4`
4. If `state: "active"`: remove `<s>` wrapper and opacity (undo)
5. Write updated HTML back to same file
6. Return: `{ path, state, updated: true }`

## 10. HTTP Sidecar (`http-sidecar.ts`)

### 10.1 Lifecycle

- Starts alongside MCP stdio server on init
- Listens on `localhost:0` (OS-assigned port)
- Writes port to `.radar-port` at vault root
- Stops on MCP server shutdown; `.radar-port` deleted

### 10.2 Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sync` | Sync all accounts, regenerate today's radar HTML, return 200 |
| `POST` | `/radar/item` | Body: `{ path, state }`. Update item visual state in radar HTML |
| `GET` | `/health` | Returns 200. Browser uses this to detect if server is running |

### 10.3 Radar HTML Integration

**Re-sync button:**
- Fixed-position button in radar header
- On click: `fetch('http://localhost:${PORT}/sync', { method: 'POST' })`
- Shows spinner during sync
- On success: `location.reload()` (file was overwritten, reload picks up new content)
- On failure (server not running): shows "Start Claude Code to enable sync" tooltip
- Port read from `<meta name="radar-port" content="${port}">` embedded at generation time

**Strikethrough on resolution:**
- Each radar item has `data-task-path` attribute
- `POST /radar/item` accepts `{ path, state }` — server modifies HTML file in place
- Also callable from Claude conversation: when `task_complete` runs, it calls `radar_update_item` to reflect the change

## 11. Startup Sequence

Updated `index.ts` initialization order:

```
1. Resolve vault path                     (existing)
2. Open/create SQLite database            (NEW — index-db.ts)
3. Run incremental vault sync             (NEW — sync.ts)
4. Start HTTP sidecar                     (NEW — http-sidecar.ts)
5. Create McpServer                       (existing)
6. Register tools                         (existing + new)
   - 27 existing tools (4 refactored for SQLite)
   - Write-path tools get re-index hooks
   - 4 new tools: account_register, account_sync,
     radar_generate, radar_update_item
7. Connect stdio transport                (existing)
```

**Shutdown:** On `SIGINT`/`SIGTERM`: close SQLite connection, stop HTTP sidecar, delete `.radar-port`.

**Tool count:** 27 existing + 4 new = 31 tools.

## 12. File Manifest

### New Files

| File | Purpose |
|------|---------|
| `plugin/mcp-server/src/index-db.ts` | SQLite connection manager, schema, migrations, query helpers |
| `plugin/mcp-server/src/sync.ts` | Vault scanner, incremental re-indexer, single-file re-index |
| `plugin/mcp-server/src/google-api.ts` | gcloud token acquisition + Calendar/Gmail REST clients |
| `plugin/mcp-server/src/http-sidecar.ts` | Localhost HTTP server for radar sync/update endpoints |
| `plugin/mcp-server/src/tools/external.ts` | `account_register`, `account_sync` MCP tools |
| `plugin/mcp-server/src/tools/radar.ts` | `radar_generate`, `radar_update_item` MCP tools |

### Modified Files

| File | Change |
|------|--------|
| `plugin/mcp-server/package.json` | Add `better-sqlite3`, `@types/better-sqlite3` |
| `plugin/mcp-server/src/index.ts` | Init SQLite, run sync, start HTTP sidecar, register new tools |
| `plugin/mcp-server/src/vault.ts` | Add `inbox/`, `memory/areas/` to `VAULT_DIRECTORIES` |
| `plugin/mcp-server/src/tools/notes.ts` | `noteSearch()` uses FTS5 |
| `plugin/mcp-server/src/tools/tasks.ts` | `taskList()` uses SQLite; write tools trigger re-index |
| `plugin/mcp-server/src/tools/memory.ts` | `memoryRead()` uses FTS5; `memoryWrite` triggers re-index |
| `plugin/mcp-server/src/tools/wikilink-tools.ts` | `wikilinkValidate()` uses wikilinks table; consolidate triggers sync |
| `.gitignore` | Add `.vault-index.db`, `.radar-port` |

### New Dependencies

| Package | Purpose |
|---------|---------|
| `better-sqlite3` | Synchronous SQLite driver (WAL mode, prepared statements) |
| `@types/better-sqlite3` | TypeScript types (devDependency) |

No other new runtime dependencies. Google API via built-in `fetch`. OAuth via `gcloud` CLI + `child_process`. HTTP sidecar via built-in `http`.

## 13. Data Flow Summary

```
Vault .md files
      │
      ▼
  sync.ts ──────────► SQLite (.vault-index.db)
  (parse, index)      ├── notes + notes_fts
                       ├── wikilinks
                       └── reference_log

gcloud CLI
      │
      ▼
  google-api.ts ────► SQLite (.vault-index.db)
  (Calendar, Gmail)   ├── external_accounts
                       ├── calendar_events
                       └── email_cache

  SQLite ◄──────────── Refactored tools (noteSearch, taskList,
                       memoryRead, wikilinkValidate)

  SQLite ◄──────────── radar_generate ──► radar-YYYY-MM-DD.html
                                                  │
                                                  ▼
                                          Browser (static HTML)
                                                  │
                                          Re-sync button
                                                  │
                                                  ▼
                                          HTTP sidecar ──► account_sync
                                                        ──► radar_generate
                                                        ──► overwrite HTML
```

## 14. SP2 Preview

SP2 builds on this foundation to deliver:

- 5 composite MCP tools: `radar_data`, `weekly_review`, `project_overview`, `quick_capture`, `search_and_summarize`
- Daily-radar skill enhancements: per-project next actions, inbox count badge, stale waiting-for escalation, stuck project detection
- Dual artifact generation: radar HTML (consumption) + daily note markdown (production)
- `/review` command (GTD Weekly Review)
- Inbox-capture skill
- Cron-based automated radar + daily note generation

SP2 gets its own brainstorm → spec → plan → implementation cycle after SP1 is complete.
