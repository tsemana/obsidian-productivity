# SP1: SQLite Foundation + Google Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SQLite sidecar index for fast vault queries and multi-account Google Calendar/Gmail access via gcloud CLI, with an interactive radar HTML output.

**Architecture:** Two parallel tracks sharing one SQLite database (`.vault-index.db`). Track A indexes vault `.md` files with FTS5 full-text search and a wikilink graph. Track B caches Google Calendar events and Gmail messages fetched via gcloud-authenticated REST calls. An HTTP sidecar enables the radar HTML to trigger re-syncs and item updates from the browser.

**Tech Stack:** TypeScript (ES2022, Node16 modules), better-sqlite3 (WAL mode), Google Calendar/Gmail REST APIs via native `fetch`, gcloud CLI for OAuth, Node built-in `http` for sidecar.

**Spec:** [docs/superpowers/specs/2026-03-29-sp1-sqlite-foundation-google-auth-design.md](../specs/2026-03-29-sp1-sqlite-foundation-google-auth-design.md)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `plugin/mcp-server/src/index-db.ts` | SQLite connection singleton, schema DDL, migration runner, query helpers |
| `plugin/mcp-server/src/sync.ts` | Vault file walker, full scan, incremental sync, single-file re-index |
| `plugin/mcp-server/src/google-api.ts` | gcloud token acquisition, Google Calendar REST client, Gmail REST client |
| `plugin/mcp-server/src/http-sidecar.ts` | Localhost HTTP server with `/sync`, `/radar/item`, `/health` endpoints |
| `plugin/mcp-server/src/tools/external.ts` | `account_register` and `account_sync` MCP tool implementations |
| `plugin/mcp-server/src/tools/radar.ts` | `radar_generate` and `radar_update_item` MCP tool implementations |

### Modified Files

| File | Change Summary |
|------|---------------|
| `plugin/mcp-server/package.json` | Add `better-sqlite3` + `@types/better-sqlite3` |
| `plugin/mcp-server/src/vault.ts` | Add `inbox/`, `memory/areas/` to `VAULT_DIRECTORIES` |
| `plugin/mcp-server/src/tools/notes.ts` | `noteSearch()` uses FTS5 when `db` is provided |
| `plugin/mcp-server/src/tools/tasks.ts` | `taskList()` uses SQLite; write tools trigger re-index |
| `plugin/mcp-server/src/tools/memory.ts` | `memoryRead()` search uses FTS5; `memoryWrite` triggers re-index |
| `plugin/mcp-server/src/tools/wikilink-tools.ts` | `wikilinkValidate()` uses wikilinks table; consolidate triggers sync |
| `plugin/mcp-server/src/index.ts` | Init SQLite, run sync, start HTTP sidecar, register 4 new tools |
| `.gitignore` | Add `.vault-index.db`, `.radar-port` |

---

## Task 0: Migration & Backward Compatibility

This task documents how existing vaults migrate to the new architecture. **No manual vault changes are required.** The upgrade is transparent.

**Files:**
- No files created or modified — this is a verification/documentation task.

- [ ] **Step 1: Verify existing vault is untouched by the upgrade**

The following invariants must hold after all subsequent tasks are complete:

| Existing vault content | Impact |
|------------------------|--------|
| `tasks/`, `tasks/done/` | Unchanged. Indexed automatically on first launch. |
| `memory/people/`, `memory/projects/`, `memory/context/` | Unchanged. Indexed automatically. |
| `memory/glossary.md` | Unchanged. Searchable via FTS5. |
| `CLAUDE.md` | Unchanged. Read by `claudemdRead` as before. |
| `daily/`, `references/`, `templates/`, `bases/`, `canvas/` | Unchanged. Non-task `.md` files indexed for search. |
| `.obsidian/` | Unchanged. Not indexed (starts with `.`, skipped by walker). |
| All 27 existing MCP tools | Same function signatures, same return shapes. `db` parameter is optional — omitting it activates the original file-scan fallback. |
| Skills, commands, connectors | Unchanged. No skill or command files are modified in SP1. |

- [ ] **Step 2: Understand what happens on first launch after upgrade**

```
MCP server starts
  → openDatabase(): creates .vault-index.db at vault root (gitignored)
  → runSync(): detects empty DB → full scan
    → walks all .md files recursively
    → parses frontmatter, extracts wikilinks
    → inserts into notes, notes_fts, wikilinks tables
    → ~5,000 notes/sec (sub-second for typical vaults)
  → startSidecar(): listens on localhost, writes .radar-port
  → registers all 31 tools (27 existing + 4 new)
  → connects stdio transport
```

No data is moved, renamed, or restructured. The index is a read-only sidecar derived entirely from existing files.

- [ ] **Step 3: Understand new directories**

Two new directories are added to `VAULT_DIRECTORIES`:

- `inbox/` — for SP2's quick-capture workflow. Created on next `vault_init` or `/start` run. Empty until the user puts things in it.
- `memory/areas/` — for PARA Areas of Responsibility. Created on next `vault_init` or `/start` run. Empty until the user creates area notes.

These are **additive only** — no existing directories are moved or renamed.

- [ ] **Step 4: Understand recovery from failure**

| Failure | Recovery |
|---------|----------|
| `.vault-index.db` is deleted | Next startup rebuilds from scratch (full scan) |
| `.vault-index.db` is corrupt | Detected on open → deleted → rebuilt |
| `better-sqlite3` fails to load (native module issue) | All tools fall back to file-scan behavior (`db` is `null`) |
| gcloud not installed | `account_register` returns a clear error message. Vault tools work fine without Google integration. |
| HTTP sidecar fails to start | MCP tools work normally. Radar HTML sync button shows "Start Claude Code to enable sync". |

- [ ] **Step 5: Document post-upgrade Google account setup**

After upgrading, the user sets up Google integration (one-time):

```bash
# 1. Install gcloud CLI (if not already installed)
# https://cloud.google.com/sdk/docs/install

# 2. Authenticate each Google account
gcloud auth login work@company.com
gcloud auth login personal@gmail.com
gcloud auth login account3@gmail.com
gcloud auth login account4@gmail.com

# 3. Register accounts with the MCP server (via Claude conversation)
# "Register my work account: work@company.com as 'work' context work"
# "Register my personal account: personal@gmail.com as 'personal' context personal"
# ... etc.
```

This is the only manual step. Everything else is automatic.

---

## Task 1: Add Dependencies and Update Config

**Files:**
- Modify: `plugin/mcp-server/package.json`
- Modify: `.gitignore`
- Modify: `plugin/mcp-server/src/vault.ts:37-49`

- [ ] **Step 1: Install better-sqlite3**

```bash
cd plugin/mcp-server && npm install better-sqlite3 && npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: Update .gitignore**

Add these lines to the end of `.gitignore`:

```
.vault-index.db
.vault-index.db-wal
.vault-index.db-shm
.radar-port
```

- [ ] **Step 3: Add `inbox/` and `memory/areas/` to VAULT_DIRECTORIES**

In `plugin/mcp-server/src/vault.ts`, replace the `VAULT_DIRECTORIES` array:

```typescript
/** Standard vault directories created by /start */
export const VAULT_DIRECTORIES = [
  "tasks",
  "tasks/done",
  "daily",
  "references",
  "inbox",
  "memory",
  "memory/people",
  "memory/projects",
  "memory/context",
  "memory/areas",
  "templates",
  "bases",
  "canvas",
];
```

- [ ] **Step 4: Verify the build still compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 5: Commit**

```bash
git add plugin/mcp-server/package.json plugin/mcp-server/package-lock.json .gitignore plugin/mcp-server/src/vault.ts
git commit -m "feat: add better-sqlite3 dependency, update vault directories and gitignore"
```

---

## Task 2: SQLite Connection Manager (`index-db.ts`)

**Files:**
- Create: `plugin/mcp-server/src/index-db.ts`

- [ ] **Step 1: Create `index-db.ts` with schema and connection management**

```typescript
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

const DB_FILENAME = ".vault-index.db";
const SCHEMA_VERSION = 1;

let db: DatabaseType | null = null;

/** Open or create the SQLite database for the given vault */
export function openDatabase(vaultPath: string): DatabaseType {
  if (db) return db;

  const dbPath = join(vaultPath, DB_FILENAME);
  try {
    db = new Database(dbPath);
  } catch {
    // Corrupt DB — delete and retry
    if (existsSync(dbPath)) unlinkSync(dbPath);
    db = new Database(dbPath);
  }

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  return db;
}

/** Get the current database connection (must call openDatabase first) */
export function getDatabase(): DatabaseType | null {
  return db;
}

/** Close the database connection */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(db: DatabaseType): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion < 1) {
    migrateV1(db);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}

function migrateV1(db: DatabaseType): void {
  db.exec(`
    -- Vault notes index
    CREATE TABLE IF NOT EXISTS notes (
      path TEXT PRIMARY KEY,
      title TEXT,
      tags TEXT,
      status TEXT,
      priority TEXT,
      due TEXT,
      context TEXT,
      project TEXT,
      assigned_to TEXT,
      area TEXT,
      created TEXT,
      modified_at INTEGER,
      content_hash TEXT,
      body_preview TEXT,
      frontmatter_json TEXT
    );

    -- Full-text search (external content mode)
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title, body,
      content='',
      tokenize='porter unicode61'
    );

    -- Wikilink graph
    CREATE TABLE IF NOT EXISTS wikilinks (
      source_path TEXT,
      target_slug TEXT,
      display_text TEXT,
      PRIMARY KEY (source_path, target_slug, display_text),
      FOREIGN KEY (source_path) REFERENCES notes(path) ON DELETE CASCADE
    );

    -- Reference frequency tracking
    CREATE TABLE IF NOT EXISTS reference_log (
      path TEXT,
      referenced_at INTEGER,
      context TEXT
    );

    -- Google accounts
    CREATE TABLE IF NOT EXISTS external_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'google',
      account_email TEXT NOT NULL,
      context TEXT,
      last_synced_at INTEGER
    );

    -- Calendar events cache
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES external_accounts(id),
      calendar_id TEXT,
      title TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      all_day INTEGER DEFAULT 0,
      attendees TEXT,
      location TEXT,
      description TEXT,
      html_link TEXT,
      rsvp_status TEXT,
      synced_at INTEGER
    );

    -- Email cache
    CREATE TABLE IF NOT EXISTS email_cache (
      id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES external_accounts(id),
      thread_id TEXT,
      subject TEXT,
      sender TEXT,
      date TEXT,
      labels TEXT,
      snippet TEXT,
      is_starred INTEGER DEFAULT 0,
      is_important INTEGER DEFAULT 0,
      html_link TEXT,
      synced_at INTEGER
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
    CREATE INDEX IF NOT EXISTS idx_notes_due ON notes(due);
    CREATE INDEX IF NOT EXISTS idx_notes_context ON notes(context);
    CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project);
    CREATE INDEX IF NOT EXISTS idx_wikilinks_target ON wikilinks(target_slug);
    CREATE INDEX IF NOT EXISTS idx_calendar_time ON calendar_events(start_time);
    CREATE INDEX IF NOT EXISTS idx_calendar_account ON calendar_events(account_id);
    CREATE INDEX IF NOT EXISTS idx_email_date ON email_cache(date);
    CREATE INDEX IF NOT EXISTS idx_email_account ON email_cache(account_id);
    CREATE INDEX IF NOT EXISTS idx_reflog_path ON reference_log(path, referenced_at);
  `);
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/index-db.ts
git commit -m "feat: add SQLite connection manager with schema and migrations"
```

---

## Task 3: Vault Scanner and Sync Engine (`sync.ts`)

**Files:**
- Create: `plugin/mcp-server/src/sync.ts`

- [ ] **Step 1: Create `sync.ts` with full scan, incremental sync, and single-file re-index**

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { parseNote } from "./frontmatter.js";
import { extractWikilinks } from "./wikilinks.js";

interface FileInfo {
  path: string;
  mtime: number;
}

/** Walk vault recursively, collecting all .md files with mtimes */
function walkVault(vaultPath: string): FileInfo[] {
  const results: FileInfo[] = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const stat = statSync(fullPath);
          results.push({
            path: relative(vaultPath, fullPath),
            mtime: stat.mtimeMs,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(vaultPath);
  return results;
}

/** Compute SHA-256 hash of a string */
function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Extract indexable fields from a parsed note */
function extractNoteRow(
  filePath: string,
  content: string,
  mtime: number,
) {
  const parsed = parseNote(content);
  const fm = parsed.frontmatter ?? {};
  const hash = contentHash(content);
  const bodyPreview = parsed.body.slice(0, 500);

  return {
    path: filePath,
    title: (fm.title as string) ?? null,
    tags: Array.isArray(fm.tags) ? JSON.stringify(fm.tags) : null,
    status: (fm.status as string) ?? null,
    priority: (fm.priority as string) ?? null,
    due: (fm.due as string) ?? null,
    context: (fm.context as string) ?? null,
    project: (fm.project as string) ?? null,
    assigned_to: (fm["assigned-to"] as string) ?? null,
    area: (fm.area as string) ?? null,
    created: (fm.created as string) ?? null,
    modified_at: mtime,
    content_hash: hash,
    body_preview: bodyPreview,
    frontmatter_json: Object.keys(fm).length > 0 ? JSON.stringify(fm) : null,
    body: parsed.body,
  };
}

/** Index a single file into the database (upsert) */
export function reindexFile(
  db: DatabaseType,
  vaultPath: string,
  filePath: string,
): void {
  const fullPath = join(vaultPath, filePath);
  let content: string;
  let mtime: number;
  try {
    content = readFileSync(fullPath, "utf-8");
    mtime = statSync(fullPath).mtimeMs;
  } catch {
    // File deleted or unreadable — remove from index
    removeFile(db, filePath);
    return;
  }

  const row = extractNoteRow(filePath, content, mtime);
  const links = extractWikilinks(content);

  const upsertNote = db.prepare(`
    INSERT INTO notes (path, title, tags, status, priority, due, context, project,
      assigned_to, area, created, modified_at, content_hash, body_preview, frontmatter_json)
    VALUES (@path, @title, @tags, @status, @priority, @due, @context, @project,
      @assigned_to, @area, @created, @modified_at, @content_hash, @body_preview, @frontmatter_json)
    ON CONFLICT(path) DO UPDATE SET
      title=excluded.title, tags=excluded.tags, status=excluded.status,
      priority=excluded.priority, due=excluded.due, context=excluded.context,
      project=excluded.project, assigned_to=excluded.assigned_to, area=excluded.area,
      created=excluded.created, modified_at=excluded.modified_at,
      content_hash=excluded.content_hash, body_preview=excluded.body_preview,
      frontmatter_json=excluded.frontmatter_json
  `);

  const deleteFts = db.prepare("DELETE FROM notes_fts WHERE rowid = (SELECT rowid FROM notes WHERE path = ?)");
  const insertFts = db.prepare("INSERT INTO notes_fts (rowid, title, body) VALUES ((SELECT rowid FROM notes WHERE path = ?), ?, ?)");
  const deleteLinks = db.prepare("DELETE FROM wikilinks WHERE source_path = ?");
  const insertLink = db.prepare("INSERT OR IGNORE INTO wikilinks (source_path, target_slug, display_text) VALUES (?, ?, ?)");

  const transaction = db.transaction(() => {
    upsertNote.run({
      path: row.path,
      title: row.title,
      tags: row.tags,
      status: row.status,
      priority: row.priority,
      due: row.due,
      context: row.context,
      project: row.project,
      assigned_to: row.assigned_to,
      area: row.area,
      created: row.created,
      modified_at: row.modified_at,
      content_hash: row.content_hash,
      body_preview: row.body_preview,
      frontmatter_json: row.frontmatter_json,
    });

    // Update FTS
    deleteFts.run(row.path);
    insertFts.run(row.path, row.title ?? "", row.body);

    // Update wikilinks
    deleteLinks.run(row.path);
    for (const link of links) {
      const targetSlug = link.target.split("#")[0].trim();
      if (targetSlug) {
        insertLink.run(row.path, targetSlug, link.display ?? "");
      }
    }
  });

  transaction();
}

/** Remove a file from the index */
function removeFile(db: DatabaseType, filePath: string): void {
  const deleteFts = db.prepare("DELETE FROM notes_fts WHERE rowid = (SELECT rowid FROM notes WHERE path = ?)");
  const deleteLinks = db.prepare("DELETE FROM wikilinks WHERE source_path = ?");
  const deleteNote = db.prepare("DELETE FROM notes WHERE path = ?");

  const transaction = db.transaction(() => {
    deleteFts.run(filePath);
    deleteLinks.run(filePath);
    deleteNote.run(filePath);
  });

  transaction();
}

/** Full scan — index every .md file in the vault */
export function fullScan(db: DatabaseType, vaultPath: string): { indexed: number } {
  const files = walkVault(vaultPath);

  const upsertNote = db.prepare(`
    INSERT INTO notes (path, title, tags, status, priority, due, context, project,
      assigned_to, area, created, modified_at, content_hash, body_preview, frontmatter_json)
    VALUES (@path, @title, @tags, @status, @priority, @due, @context, @project,
      @assigned_to, @area, @created, @modified_at, @content_hash, @body_preview, @frontmatter_json)
    ON CONFLICT(path) DO UPDATE SET
      title=excluded.title, tags=excluded.tags, status=excluded.status,
      priority=excluded.priority, due=excluded.due, context=excluded.context,
      project=excluded.project, assigned_to=excluded.assigned_to, area=excluded.area,
      created=excluded.created, modified_at=excluded.modified_at,
      content_hash=excluded.content_hash, body_preview=excluded.body_preview,
      frontmatter_json=excluded.frontmatter_json
  `);
  const insertFts = db.prepare("INSERT INTO notes_fts (rowid, title, body) VALUES ((SELECT rowid FROM notes WHERE path = ?), ?, ?)");
  const insertLink = db.prepare("INSERT OR IGNORE INTO wikilinks (source_path, target_slug, display_text) VALUES (?, ?, ?)");

  const transaction = db.transaction(() => {
    // Clear existing data for full rebuild
    db.exec("DELETE FROM notes_fts");
    db.exec("DELETE FROM wikilinks");
    db.exec("DELETE FROM notes");

    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(join(vaultPath, file.path), "utf-8");
      } catch {
        continue;
      }

      const row = extractNoteRow(file.path, content, file.mtime);
      const links = extractWikilinks(content);

      upsertNote.run({
        path: row.path,
        title: row.title,
        tags: row.tags,
        status: row.status,
        priority: row.priority,
        due: row.due,
        context: row.context,
        project: row.project,
        assigned_to: row.assigned_to,
        area: row.area,
        created: row.created,
        modified_at: row.modified_at,
        content_hash: row.content_hash,
        body_preview: row.body_preview,
        frontmatter_json: row.frontmatter_json,
      });

      insertFts.run(row.path, row.title ?? "", row.body);

      for (const link of links) {
        const targetSlug = link.target.split("#")[0].trim();
        if (targetSlug) {
          insertLink.run(row.path, targetSlug, link.display ?? "");
        }
      }
    }
  });

  transaction();
  return { indexed: files.length };
}

/** Incremental sync — only process new, modified, and deleted files */
export function incrementalSync(
  db: DatabaseType,
  vaultPath: string,
): { added: number; updated: number; deleted: number } {
  const diskFiles = walkVault(vaultPath);
  const diskMap = new Map(diskFiles.map((f) => [f.path, f.mtime]));

  // Get all indexed paths and mtimes
  const indexed = db.prepare("SELECT path, modified_at, content_hash FROM notes").all() as Array<{
    path: string;
    modified_at: number;
    content_hash: string;
  }>;
  const indexedMap = new Map(indexed.map((r) => [r.path, r]));

  let added = 0;
  let updated = 0;
  let deleted = 0;

  const transaction = db.transaction(() => {
    // Find new and modified files
    for (const [filePath, mtime] of diskMap) {
      const existing = indexedMap.get(filePath);
      if (!existing) {
        // New file
        reindexFile(db, vaultPath, filePath);
        added++;
      } else if (Math.abs(existing.modified_at - mtime) > 1) {
        // mtime changed — check content hash
        let content: string;
        try {
          content = readFileSync(join(vaultPath, filePath), "utf-8");
        } catch {
          continue;
        }
        const hash = contentHash(content);
        if (hash !== existing.content_hash) {
          reindexFile(db, vaultPath, filePath);
          updated++;
        } else {
          // Only mtime changed, update it
          db.prepare("UPDATE notes SET modified_at = ? WHERE path = ?").run(mtime, filePath);
        }
      }
    }

    // Find deleted files
    for (const [filePath] of indexedMap) {
      if (!diskMap.has(filePath)) {
        removeFile(db, filePath);
        deleted++;
      }
    }
  });

  transaction();
  return { added, updated, deleted };
}

/** Run sync — full scan if DB is empty, incremental otherwise */
export function runSync(
  db: DatabaseType,
  vaultPath: string,
): { mode: "full" | "incremental"; added: number; updated: number; deleted: number; indexed?: number } {
  const count = (db.prepare("SELECT COUNT(*) as cnt FROM notes").get() as { cnt: number }).cnt;

  if (count === 0) {
    const result = fullScan(db, vaultPath);
    return { mode: "full", added: result.indexed, updated: 0, deleted: 0, indexed: result.indexed };
  }

  const result = incrementalSync(db, vaultPath);
  return { mode: "incremental", ...result };
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/sync.ts
git commit -m "feat: add vault scanner with full scan, incremental sync, and single-file re-index"
```

---

## Task 4: Refactor `noteSearch` to Use FTS5

**Files:**
- Modify: `plugin/mcp-server/src/tools/notes.ts`

- [ ] **Step 1: Add optional `db` parameter and FTS5 search path to `noteSearch`**

Replace the existing `noteSearch` function (lines 83-148) in `plugin/mcp-server/src/tools/notes.ts` with:

```typescript
/** note_search — search vault notes by content and/or frontmatter */
export function noteSearch(
  vaultPath: string,
  options: {
    query?: string;
    frontmatter_filter?: Record<string, unknown>;
    directory?: string;
    extension?: string;
    limit?: number;
  },
  db?: import("better-sqlite3").Database,
): { results: Array<{ path: string; frontmatter?: Record<string, unknown>; matches?: Array<{ line: number; text: string }> }>; count: number } {
  const { query, frontmatter_filter, directory, extension = ".md", limit = 50 } = options;

  // SQLite-backed search when db is available and searching .md files
  if (db && extension === ".md") {
    return noteSearchIndexed(db, vaultPath, query, frontmatter_filter, directory, limit);
  }

  // Fallback: original file-scan implementation
  return noteSearchFileScan(vaultPath, query, frontmatter_filter, directory, extension, limit);
}

function noteSearchIndexed(
  db: import("better-sqlite3").Database,
  vaultPath: string,
  query: string | undefined,
  frontmatter_filter: Record<string, unknown> | undefined,
  directory: string | undefined,
  limit: number,
): { results: Array<{ path: string; frontmatter?: Record<string, unknown>; matches?: Array<{ line: number; text: string }> }>; count: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Directory filter
  if (directory && directory !== ".") {
    conditions.push("n.path LIKE ?");
    params.push(`${directory}/%`);
  }

  // Frontmatter filter on indexed columns
  if (frontmatter_filter) {
    const indexedCols = ["status", "priority", "context", "project", "assigned_to", "area", "due"];
    for (const [key, value] of Object.entries(frontmatter_filter)) {
      const colName = key === "assigned-to" ? "assigned_to" : key;
      if (indexedCols.includes(colName) && typeof value === "string") {
        conditions.push(`n.${colName} = ?`);
        params.push(value);
      } else if (key === "tags" && typeof value === "string") {
        conditions.push("n.tags LIKE ?");
        params.push(`%${JSON.stringify(value).slice(1, -1)}%`);
      } else if (typeof value === "string") {
        // Fall back to JSON search for non-indexed fields
        conditions.push("n.frontmatter_json LIKE ?");
        params.push(`%${value}%`);
      }
    }
  }

  let results: Array<{ path: string; frontmatter?: Record<string, unknown>; matches?: Array<{ line: number; text: string }> }>;

  if (query) {
    // FTS5 search with ranking
    const ftsQuery = query.split(/\s+/).map((term) => `"${term.replace(/"/g, '""')}"`).join(" ");
    const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
    const sql = `
      SELECT n.path, n.frontmatter_json, bm25(notes_fts) as rank
      FROM notes_fts fts
      JOIN notes n ON n.rowid = fts.rowid
      WHERE notes_fts MATCH ? ${where}
      ORDER BY rank
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(ftsQuery, ...params, limit) as Array<{
      path: string;
      frontmatter_json: string | null;
      rank: number;
    }>;

    results = rows.map((row) => {
      const entry: { path: string; frontmatter?: Record<string, unknown>; matches?: Array<{ line: number; text: string }> } = { path: row.path };
      if (row.frontmatter_json) {
        try { entry.frontmatter = JSON.parse(row.frontmatter_json); } catch {}
      }
      // Get line-level matches from the file for context
      try {
        const content = readFileSync(join(vaultPath, row.path), "utf-8");
        const queryLower = query.toLowerCase();
        const lines = content.split("\n");
        const matches: Array<{ line: number; text: string }> = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(queryLower)) {
            matches.push({ line: i + 1, text: lines[i].trim() });
            if (matches.length >= 5) break;
          }
        }
        if (matches.length > 0) entry.matches = matches;
      } catch {}
      return entry;
    });
  } else {
    // Frontmatter-only search (no text query)
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT path, frontmatter_json FROM notes ${where} LIMIT ?`;
    const rows = db.prepare(sql).all(...params, limit) as Array<{
      path: string;
      frontmatter_json: string | null;
    }>;

    results = rows.map((row) => {
      const entry: { path: string; frontmatter?: Record<string, unknown> } = { path: row.path };
      if (row.frontmatter_json) {
        try { entry.frontmatter = JSON.parse(row.frontmatter_json); } catch {}
      }
      return entry;
    });
  }

  return { results, count: results.length };
}

function noteSearchFileScan(
  vaultPath: string,
  query: string | undefined,
  frontmatter_filter: Record<string, unknown> | undefined,
  directory: string | undefined,
  extension: string,
  limit: number,
): { results: Array<{ path: string; frontmatter?: Record<string, unknown>; matches?: Array<{ line: number; text: string }> }>; count: number } {
  const searchDir = directory ?? ".";

  const listing = vaultList(vaultPath, searchDir, {
    include_frontmatter: !!frontmatter_filter,
    recursive: true,
    extension,
  });

  const results: Array<{ path: string; frontmatter?: Record<string, unknown>; matches?: Array<{ line: number; text: string }> }> = [];

  for (const file of listing.files) {
    if (results.length >= limit) break;

    if (frontmatter_filter) {
      if (!file.frontmatter || !matchesFrontmatter(file.frontmatter, frontmatter_filter)) {
        continue;
      }
    }

    if (query) {
      try {
        const content = readFileSync(join(vaultPath, file.path), "utf-8");
        const queryLower = query.toLowerCase();
        const lines = content.split("\n");
        const matches: Array<{ line: number; text: string }> = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(queryLower)) {
            matches.push({ line: i + 1, text: lines[i].trim() });
          }
        }

        if (matches.length === 0) continue;

        const result: { path: string; frontmatter?: Record<string, unknown>; matches: Array<{ line: number; text: string }> } = {
          path: file.path,
          matches: matches.slice(0, 5),
        };
        if (file.frontmatter) result.frontmatter = file.frontmatter;
        results.push(result);
      } catch {
        continue;
      }
    } else {
      const result: { path: string; frontmatter?: Record<string, unknown> } = { path: file.path };
      if (file.frontmatter) result.frontmatter = file.frontmatter;
      results.push(result);
    }
  }

  return { results, count: results.length };
}
```

Also add the `join` import at the top of the file (it's already imported via `dirname`):

The file already imports `join` from `node:path`. No change needed for imports.

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/tools/notes.ts
git commit -m "feat: refactor noteSearch to use FTS5 with file-scan fallback"
```

---

## Task 5: Refactor `taskList` to Use SQLite

**Files:**
- Modify: `plugin/mcp-server/src/tools/tasks.ts`

- [ ] **Step 1: Add SQLite-backed `taskList` and re-index hooks**

Add the import at the top of `plugin/mcp-server/src/tools/tasks.ts`:

```typescript
import { reindexFile } from "../sync.js";
import type { Database as DatabaseType } from "better-sqlite3";
```

Replace the `taskList` function (lines 141-260) with:

```typescript
/** task_list — list tasks with filtering */
export function taskList(
  vaultPath: string,
  options: {
    status?: string | string[];
    priority?: string | string[];
    context?: string;
    project?: string;
    due_before?: string;
    due_after?: string;
    include_done?: boolean;
    assigned_to?: string;
  } = {},
  db?: DatabaseType,
): { tasks: Array<{ path: string; frontmatter: Record<string, unknown>; body_preview: string }>; count: number } {
  if (db) {
    return taskListIndexed(db, options);
  }
  return taskListFileScan(vaultPath, options);
}

function taskListIndexed(
  db: DatabaseType,
  options: {
    status?: string | string[];
    priority?: string | string[];
    context?: string;
    project?: string;
    due_before?: string;
    due_after?: string;
    include_done?: boolean;
    assigned_to?: string;
  },
): { tasks: Array<{ path: string; frontmatter: Record<string, unknown>; body_preview: string }>; count: number } {
  const conditions: string[] = ["tags LIKE '%\"task\"%'"];
  const params: unknown[] = [];

  // Path scope: tasks/ and optionally tasks/done/
  if (options.include_done) {
    conditions.push("(path LIKE 'tasks/%')");
  } else {
    conditions.push("(path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%')");
  }

  // Status filter
  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }

  // Priority filter
  if (options.priority) {
    const priorities = Array.isArray(options.priority) ? options.priority : [options.priority];
    conditions.push(`priority IN (${priorities.map(() => "?").join(",")})`);
    params.push(...priorities);
  }

  // Context filter
  if (options.context) {
    conditions.push("context = ?");
    params.push(options.context);
  }

  // Project filter (substring match)
  if (options.project) {
    conditions.push("project LIKE ?");
    params.push(`%${options.project}%`);
  }

  // Assigned-to filter (substring match)
  if (options.assigned_to) {
    conditions.push("assigned_to LIKE ?");
    params.push(`%${options.assigned_to}%`);
  }

  // Due date filters
  if (options.due_before) {
    conditions.push("due IS NOT NULL AND due < ?");
    params.push(options.due_before);
  }
  if (options.due_after) {
    conditions.push("due IS NOT NULL AND due > ?");
    params.push(options.due_after);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT path, frontmatter_json, body_preview FROM notes ${where} ORDER BY
    CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
    due ASC NULLS LAST`;

  const rows = db.prepare(sql).all(...params) as Array<{
    path: string;
    frontmatter_json: string | null;
    body_preview: string | null;
  }>;

  const tasks = rows.map((row) => ({
    path: row.path,
    frontmatter: row.frontmatter_json ? JSON.parse(row.frontmatter_json) : {},
    body_preview: row.body_preview ?? "",
  }));

  return { tasks, count: tasks.length };
}

function taskListFileScan(
  vaultPath: string,
  options: {
    status?: string | string[];
    priority?: string | string[];
    context?: string;
    project?: string;
    due_before?: string;
    due_after?: string;
    include_done?: boolean;
    assigned_to?: string;
  },
): { tasks: Array<{ path: string; frontmatter: Record<string, unknown>; body_preview: string }>; count: number } {
  const {
    status,
    priority,
    context,
    project,
    due_before,
    due_after,
    include_done = false,
    assigned_to,
  } = options;

  const listing = vaultList(vaultPath, "tasks", {
    include_frontmatter: true,
    recursive: false,
    extension: ".md",
  });

  let files = listing.files;

  if (include_done) {
    const doneListing = vaultList(vaultPath, "tasks/done", {
      include_frontmatter: true,
      recursive: false,
      extension: ".md",
    });
    files = files.concat(doneListing.files);
  }

  const tasks: Array<{ path: string; frontmatter: Record<string, unknown>; body_preview: string }> = [];

  for (const file of files) {
    const fm = file.frontmatter;
    if (!fm) continue;

    const tags = fm.tags;
    if (!Array.isArray(tags) || !tags.includes("task")) continue;

    if (status) {
      const statusArr = Array.isArray(status) ? status : [status];
      if (!statusArr.includes(fm.status as string)) continue;
    }

    if (priority) {
      const priorityArr = Array.isArray(priority) ? priority : [priority];
      if (!priorityArr.includes(fm.priority as string)) continue;
    }

    if (context) {
      const fmContext = fm.context;
      if (Array.isArray(fmContext)) {
        if (!fmContext.includes(context)) continue;
      } else if (fmContext !== context) {
        continue;
      }
    }

    if (project && typeof fm.project === "string") {
      if (!fm.project.includes(project)) continue;
    } else if (project && !fm.project) {
      continue;
    }

    if (assigned_to && typeof fm["assigned-to"] === "string") {
      if (!(fm["assigned-to"] as string).includes(assigned_to)) continue;
    } else if (assigned_to && !fm["assigned-to"]) {
      continue;
    }

    if (due_before && typeof fm.due === "string") {
      if (fm.due >= due_before) continue;
    } else if (due_before && !fm.due) {
      continue;
    }

    if (due_after && typeof fm.due === "string") {
      if (fm.due <= due_after) continue;
    }

    let bodyPreview = "";
    try {
      const content = readFileSync(join(vaultPath, file.path), "utf-8");
      const parsed = parseNote(content);
      const lines = parsed.body.trim().split("\n").slice(0, 5);
      bodyPreview = lines.join("\n");
    } catch {}

    tasks.push({ path: file.path, frontmatter: fm, body_preview: bodyPreview });
  }

  return { tasks, count: tasks.length };
}
```

- [ ] **Step 2: Add re-index hooks to `taskCreate`, `taskUpdate`, and `taskComplete`**

Add an optional `db` parameter to each function and call `reindexFile` after successful writes.

For `taskCreate`, add `db?: DatabaseType` as the last parameter and add re-index after the successful write:

```typescript
export function taskCreate(
  vaultPath: string,
  options: {
    title: string;
    status?: string;
    priority?: string;
    due?: string;
    context?: string;
    assigned_to?: string;
    project?: string;
    waiting_on?: string;
    body?: string;
    filename?: string;
  },
  db?: DatabaseType,
): { path: string; frontmatter: Record<string, unknown> } | { error: string; message: string } {
  // ... all existing implementation stays the same until the return ...

  if ("error" in result) return result;
  if (db) reindexFile(db, vaultPath, result.path);
  return { path: result.path, frontmatter };
}
```

For `taskUpdate`, add `db?: DatabaseType` as the last parameter and add re-index after the successful write:

```typescript
export function taskUpdate(
  vaultPath: string,
  path: string,
  options: {
    frontmatter?: Record<string, unknown>;
    append_body?: string;
    replace_section?: { heading: string; content: string };
  },
  db?: DatabaseType,
): { path: string; frontmatter: Record<string, unknown> } | { error: string; path: string; message: string } {
  // ... all existing implementation stays the same until the return ...

  if ("error" in writeResult) return { error: writeResult.error, path, message: (writeResult as { message: string }).message };
  if (db) reindexFile(db, vaultPath, path);
  return { path, frontmatter: fm };
}
```

For `taskComplete`, add `db?: DatabaseType` as the last parameter and re-index both old and new paths after the move:

```typescript
export function taskComplete(
  vaultPath: string,
  path: string,
  db?: DatabaseType,
): { old_path: string; new_path: string; completed: string } | { error: string; message: string } {
  // ... all existing implementation stays the same until the return ...

  if ("error" in moveResult) return moveResult;
  if (db) {
    reindexFile(db, vaultPath, path);    // removes old (file no longer at old path)
    reindexFile(db, vaultPath, newPath); // indexes new location
  }
  return { old_path: path, new_path: newPath, completed };
}
```

- [ ] **Step 3: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/src/tools/tasks.ts
git commit -m "feat: refactor taskList to use SQLite with file-scan fallback, add re-index hooks"
```

---

## Task 6: Refactor `memoryRead` to Use FTS5

**Files:**
- Modify: `plugin/mcp-server/src/tools/memory.ts`

- [ ] **Step 1: Add SQLite search path to `memoryRead` and re-index hook to `memoryWrite`**

Add imports at the top of `plugin/mcp-server/src/tools/memory.ts`:

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import { reindexFile } from "../sync.js";
```

Replace the `memoryRead` function (lines 14-101) with:

```typescript
/** memory_read — read a memory file by path or search by name/alias */
export function memoryRead(
  vaultPath: string,
  options: {
    path?: string;
    search?: string;
    type?: "person" | "project" | "glossary" | "context" | "any";
  },
  db?: DatabaseType,
): { path: string; frontmatter: Record<string, unknown> | null; body: string } | { matches: MemoryMatch[] } | { error: string; message: string } {
  // Direct path access — unchanged
  if (options.path) {
    const result = noteRead(vaultPath, options.path);
    if ("error" in result) return result;
    return { path: result.path, frontmatter: result.frontmatter, body: result.body };
  }

  if (!options.search) {
    return { error: "invalid_params", message: "Either path or search must be provided" };
  }

  // SQLite-backed search
  if (db) {
    return memorySearchIndexed(db, vaultPath, options.search, options.type ?? "any");
  }

  // Fallback: original file-scan search
  return memorySearchFileScan(vaultPath, options.search, options.type ?? "any");
}

function memorySearchIndexed(
  db: DatabaseType,
  vaultPath: string,
  search: string,
  type: string,
): { path: string; frontmatter: Record<string, unknown> | null; body: string } | { matches: MemoryMatch[] } | { error: string; message: string } {
  // Map type to path prefix
  const pathPrefixes: Record<string, string> = {
    person: "memory/people/",
    project: "memory/projects/",
    context: "memory/context/",
    area: "memory/areas/",
  };

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (type !== "any" && type !== "glossary") {
    const prefix = pathPrefixes[type];
    if (prefix) {
      conditions.push("n.path LIKE ?");
      params.push(`${prefix}%`);
    }
  } else if (type === "any") {
    conditions.push("n.path LIKE 'memory/%'");
  }

  // FTS5 search
  const ftsQuery = search.split(/\s+/).map((term) => `"${term.replace(/"/g, '""')}"`).join(" ");
  const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
  const sql = `
    SELECT n.path, n.frontmatter_json, bm25(notes_fts) as rank
    FROM notes_fts fts
    JOIN notes n ON n.rowid = fts.rowid
    WHERE notes_fts MATCH ? ${where}
    ORDER BY rank
    LIMIT 10
  `;

  let rows = db.prepare(sql).all(ftsQuery, ...params) as Array<{
    path: string;
    frontmatter_json: string | null;
  }>;

  // Also try filename/title match if FTS returns nothing
  if (rows.length === 0) {
    const searchLower = search.toLowerCase();
    const likeSql = type === "any"
      ? "SELECT path, frontmatter_json FROM notes WHERE path LIKE 'memory/%' AND (LOWER(title) LIKE ? OR LOWER(path) LIKE ?) LIMIT 10"
      : `SELECT path, frontmatter_json FROM notes WHERE path LIKE ? AND (LOWER(title) LIKE ? OR LOWER(path) LIKE ?) LIMIT 10`;

    if (type === "any") {
      rows = db.prepare(likeSql).all(`%${searchLower}%`, `%${searchLower}%`) as typeof rows;
    } else {
      const prefix = pathPrefixes[type] ?? "memory/";
      rows = db.prepare(likeSql).all(`${prefix}%`, `%${searchLower}%`, `%${searchLower}%`) as typeof rows;
    }
  }

  // Handle glossary type
  if ((type === "glossary" || type === "any") && rows.length === 0) {
    const glossaryResult = searchGlossary(vaultPath, search.toLowerCase());
    if (glossaryResult) {
      return { matches: [glossaryResult] };
    }
  }

  if (rows.length === 0) {
    return { matches: [] };
  }

  // If exactly one match, return full content
  if (rows.length === 1) {
    const result = noteRead(vaultPath, rows[0].path);
    if ("error" in result) return result;
    return { path: result.path, frontmatter: result.frontmatter, body: result.body };
  }

  const matches: MemoryMatch[] = rows.map((row) => ({
    path: row.path,
    frontmatter: row.frontmatter_json ? JSON.parse(row.frontmatter_json) : {},
    match_reason: `indexed search: ${search}`,
  }));

  return { matches };
}

function memorySearchFileScan(
  vaultPath: string,
  search: string,
  type: string,
): { path: string; frontmatter: Record<string, unknown> | null; body: string } | { matches: MemoryMatch[] } | { error: string; message: string } {
  const searchTerm = search.toLowerCase();
  const matches: MemoryMatch[] = [];

  const searchDirs: Array<{ dir: string; typeLabel: string }> = [];
  if (type === "person" || type === "any") {
    searchDirs.push({ dir: "memory/people", typeLabel: "person" });
  }
  if (type === "project" || type === "any") {
    searchDirs.push({ dir: "memory/projects", typeLabel: "project" });
  }
  if (type === "glossary" || type === "any") {
    const glossaryResult = searchGlossary(vaultPath, searchTerm);
    if (glossaryResult) matches.push(glossaryResult);
  }
  if (type === "context" || type === "any") {
    const listing = vaultList(vaultPath, "memory/context", {
      include_frontmatter: true, recursive: false, extension: ".md",
    });
    for (const file of listing.files) {
      if (matchesSearch(file, searchTerm)) {
        matches.push({
          path: file.path,
          frontmatter: file.frontmatter ?? {},
          match_reason: `context file: ${file.name}`,
        });
      }
    }
  }

  for (const { dir, typeLabel } of searchDirs) {
    const listing = vaultList(vaultPath, dir, {
      include_frontmatter: true, recursive: false, extension: ".md",
    });
    for (const file of listing.files) {
      const reason = matchesSearch(file, searchTerm);
      if (reason) {
        matches.push({
          path: file.path,
          frontmatter: file.frontmatter ?? {},
          match_reason: `${typeLabel}: ${reason}`,
        });
      }
    }
  }

  if (matches.length === 1) {
    const result = noteRead(vaultPath, matches[0].path);
    if ("error" in result) return result;
    return { path: result.path, frontmatter: result.frontmatter, body: result.body };
  }

  return { matches };
}
```

Add `db` parameter and re-index hook to `memoryWrite`:

```typescript
export function memoryWrite(
  vaultPath: string,
  path: string,
  options: { /* ... same ... */ },
  db?: DatabaseType,
): { path: string; created: boolean; frontmatter: Record<string, unknown> } | { error: string; message: string } {
  // ... existing implementation unchanged until the end ...

  if ("error" in writeResult) return { error: writeResult.error, message: (writeResult as { message: string }).message };
  if (db) reindexFile(db, vaultPath, path);
  return { path, created: !exists, frontmatter: fm };
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/tools/memory.ts
git commit -m "feat: refactor memoryRead to use FTS5 with file-scan fallback, add re-index hook"
```

---

## Task 7: Refactor `wikilinkValidate` to Use SQLite

**Files:**
- Modify: `plugin/mcp-server/src/tools/wikilink-tools.ts`

- [ ] **Step 1: Add SQLite-backed validation and sync trigger**

Add imports at the top of `plugin/mcp-server/src/tools/wikilink-tools.ts`:

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import { incrementalSync } from "../sync.js";
```

Replace `wikilinkValidate` (lines 124-214) with:

```typescript
/** wikilink_validate — find broken wikilinks in the vault */
export function wikilinkValidate(
  vaultPath: string,
  directory?: string,
  fixSuggestions: boolean = true,
  db?: DatabaseType,
): {
  broken_links: Array<{ source_path: string; link_text: string; suggestions: string[] }>;
  count: number;
} {
  if (db) {
    return wikilinkValidateIndexed(db, directory, fixSuggestions);
  }
  return wikilinkValidateFileScan(vaultPath, directory, fixSuggestions);
}

function wikilinkValidateIndexed(
  db: DatabaseType,
  directory: string | undefined,
  fixSuggestions: boolean,
): {
  broken_links: Array<{ source_path: string; link_text: string; suggestions: string[] }>;
  count: number;
} {
  // Build known targets set from notes table
  const knownTargets = new Map<string, string>();
  const allNotes = db.prepare("SELECT path, title, frontmatter_json FROM notes").all() as Array<{
    path: string;
    title: string | null;
    frontmatter_json: string | null;
  }>;

  for (const note of allNotes) {
    const name = note.path.split("/").pop()?.replace(".md", "") ?? "";
    knownTargets.set(name.toLowerCase(), note.path);
    if (note.title) {
      knownTargets.set(note.title.toLowerCase(), note.path);
    }
    if (note.frontmatter_json) {
      try {
        const fm = JSON.parse(note.frontmatter_json);
        if (Array.isArray(fm.aliases)) {
          for (const alias of fm.aliases) {
            if (typeof alias === "string") {
              knownTargets.set(alias.toLowerCase(), note.path);
            }
          }
        }
      } catch {}
    }
  }

  // Get all wikilinks, optionally filtered by directory
  let links: Array<{ source_path: string; target_slug: string; display_text: string }>;
  if (directory && directory !== ".") {
    links = db.prepare("SELECT source_path, target_slug, display_text FROM wikilinks WHERE source_path LIKE ?")
      .all(`${directory}/%`) as typeof links;
  } else {
    links = db.prepare("SELECT source_path, target_slug, display_text FROM wikilinks").all() as typeof links;
  }

  const brokenLinks: Array<{ source_path: string; link_text: string; suggestions: string[] }> = [];

  for (const link of links) {
    const target = link.target_slug.toLowerCase();
    if (target.startsWith("#")) continue;
    const baseTarget = target.split("#")[0].trim();
    if (!baseTarget) continue;

    if (!knownTargets.has(baseTarget)) {
      const suggestions: string[] = [];
      if (fixSuggestions) {
        for (const [known, kPath] of knownTargets) {
          if (known.includes(baseTarget) || baseTarget.includes(known)) {
            suggestions.push(kPath);
            if (suggestions.length >= 3) break;
          }
        }
      }

      const displayPart = link.display_text ? `|${link.display_text}` : "";
      brokenLinks.push({
        source_path: link.source_path,
        link_text: `[[${link.target_slug}${displayPart}]]`,
        suggestions,
      });
    }
  }

  return { broken_links: brokenLinks, count: brokenLinks.length };
}

function wikilinkValidateFileScan(
  vaultPath: string,
  directory: string | undefined,
  fixSuggestions: boolean,
): {
  broken_links: Array<{ source_path: string; link_text: string; suggestions: string[] }>;
  count: number;
} {
  // ... keep the original file-scan implementation (the existing function body) ...
  const searchDir = directory ?? ".";
  const allFiles = allMdFiles(
    join(vaultPath, searchDir === "." ? "" : searchDir),
    vaultPath,
  );

  const knownTargets = new Map<string, string>();
  const allVaultFiles = allMdFiles(vaultPath, vaultPath);
  for (const filePath of allVaultFiles) {
    const name = filePath.split("/").pop()?.replace(".md", "") ?? "";
    knownTargets.set(name.toLowerCase(), filePath);
    try {
      const content = readFileSync(join(vaultPath, filePath), "utf-8");
      const parsed = parseNote(content);
      if (parsed.frontmatter?.aliases && Array.isArray(parsed.frontmatter.aliases)) {
        for (const alias of parsed.frontmatter.aliases) {
          if (typeof alias === "string") {
            knownTargets.set(alias.toLowerCase(), filePath);
          }
        }
      }
      if (parsed.frontmatter?.title && typeof parsed.frontmatter.title === "string") {
        knownTargets.set((parsed.frontmatter.title as string).toLowerCase(), filePath);
      }
    } catch {}
  }

  const brokenLinks: Array<{ source_path: string; link_text: string; suggestions: string[] }> = [];

  for (const filePath of allFiles) {
    let content: string;
    try {
      content = readFileSync(join(vaultPath, filePath), "utf-8");
    } catch {
      continue;
    }

    const links = extractWikilinks(content);
    for (const link of links) {
      const target = link.target.toLowerCase();
      if (target.startsWith("#")) continue;
      const baseTarget = target.split("#")[0].trim();
      if (!baseTarget) continue;

      if (!knownTargets.has(baseTarget)) {
        const suggestions: string[] = [];
        if (fixSuggestions) {
          for (const [known, kPath] of knownTargets) {
            if (known.includes(baseTarget) || baseTarget.includes(known)) {
              suggestions.push(kPath);
              if (suggestions.length >= 3) break;
            }
          }
        }
        brokenLinks.push({ source_path: filePath, link_text: link.raw, suggestions });
      }
    }
  }

  return { broken_links: brokenLinks, count: brokenLinks.length };
}
```

Add `db` parameter and sync trigger to `wikilinkConsolidate`:

```typescript
export function wikilinkConsolidate(
  vaultPath: string,
  name: string,
  dryRun: boolean = false,
  db?: DatabaseType,
): { /* ... same return type ... */ } | { error: string; message: string } {
  // ... existing implementation unchanged ...

  // After all writes complete, trigger incremental sync
  if (!dryRun && db) {
    incrementalSync(db, vaultPath);
  }

  return { canonical: filename, display_name: displayName, aliases: uniqueAliases,
    files_scanned: allFiles.length, links_updated: totalLinksUpdated, changed_files: changedFiles };
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/tools/wikilink-tools.ts
git commit -m "feat: refactor wikilinkValidate to use SQLite, add sync trigger to consolidate"
```

---

## Task 8: Google API Client (`google-api.ts`)

**Files:**
- Create: `plugin/mcp-server/src/google-api.ts`

- [ ] **Step 1: Create `google-api.ts` with gcloud token acquisition, Calendar client, and Gmail client**

```typescript
import { execSync } from "node:child_process";
import type { Database as DatabaseType } from "better-sqlite3";

// ─── Token Acquisition ────────────────────────────────────────────────────

/** Get an access token for a Google account via gcloud CLI */
export function getAccessToken(email: string): string {
  try {
    const token = execSync(`gcloud auth print-access-token --account=${email}`, {
      encoding: "utf-8",
      timeout: 15000,
    }).trim();
    if (!token) {
      throw new Error(`Empty token returned for ${email}`);
    }
    return token;
  } catch (e) {
    throw new Error(
      `Failed to get access token for ${email}. Run: gcloud auth login ${email}\n${e}`,
    );
  }
}

// ─── Calendar Client ──────────────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  calendar_id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  attendees: string[];
  location: string | null;
  description: string | null;
  html_link: string | null;
  rsvp_status: string | null;
}

/** Fetch calendar events for an account */
export async function fetchCalendarEvents(
  token: string,
  options: {
    timeMin?: string;
    timeMax?: string;
    timeZone?: string;
  } = {},
): Promise<CalendarEvent[]> {
  const now = new Date();
  const timeMin = options.timeMin ?? new Date(now.getTime() - 7 * 86400000).toISOString();
  const timeMax = options.timeMax ?? new Date(now.getTime() + 14 * 86400000).toISOString();
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // First, list all calendars
  const calendarsUrl = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
  const calendarsRes = await fetch(calendarsUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!calendarsRes.ok) {
    throw new Error(`Calendar list failed: ${calendarsRes.status} ${await calendarsRes.text()}`);
  }
  const calendarsData = await calendarsRes.json() as { items?: Array<{ id: string }> };
  const calendarIds = (calendarsData.items ?? []).map((c) => c.id);

  const allEvents: CalendarEvent[] = [];

  for (const calendarId of calendarIds) {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        timeZone,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
      const eventsRes = await fetch(eventsUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!eventsRes.ok) {
        // Skip calendars we can't read (permissions)
        break;
      }
      const eventsData = await eventsRes.json() as {
        items?: Array<{
          id: string;
          summary?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
          attendees?: Array<{ email: string; responseStatus?: string; self?: boolean }>;
          location?: string;
          description?: string;
          htmlLink?: string;
          status?: string;
        }>;
        nextPageToken?: string;
      };

      for (const event of eventsData.items ?? []) {
        if (event.status === "cancelled") continue;

        const isAllDay = !event.start?.dateTime;
        const selfAttendee = event.attendees?.find((a) => a.self);

        allEvents.push({
          id: event.id,
          calendar_id: calendarId,
          title: event.summary ?? "(No title)",
          start_time: event.start?.dateTime ?? event.start?.date ?? "",
          end_time: event.end?.dateTime ?? event.end?.date ?? null,
          all_day: isAllDay,
          attendees: (event.attendees ?? []).map((a) => a.email),
          location: event.location ?? null,
          description: event.description ?? null,
          html_link: event.htmlLink ?? null,
          rsvp_status: selfAttendee?.responseStatus ?? null,
        });
      }

      pageToken = eventsData.nextPageToken;
    } while (pageToken);
  }

  return allEvents;
}

// ─── Gmail Client ─────────────────────────────────────────────────────────

interface EmailMessage {
  id: string;
  thread_id: string;
  subject: string;
  sender: string;
  date: string;
  labels: string[];
  snippet: string;
  is_starred: boolean;
  is_important: boolean;
  html_link: string;
}

/** Fetch email messages for an account */
export async function fetchEmails(
  token: string,
  accountEmail: string,
  options: {
    query?: string;
    maxResults?: number;
  } = {},
): Promise<EmailMessage[]> {
  const query = options.query ?? "is:unread (is:important OR is:starred)";
  const maxResults = options.maxResults ?? 20;

  // List message IDs
  const listParams = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const listUrl = `https://www.googleapis.com/gmail/v1/users/me/messages?${listParams}`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    throw new Error(`Gmail list failed: ${listRes.status} ${await listRes.text()}`);
  }
  const listData = await listRes.json() as { messages?: Array<{ id: string; threadId: string }> };

  if (!listData.messages || listData.messages.length === 0) {
    return [];
  }

  // Fetch each message's details
  const messages: EmailMessage[] = [];
  for (const msg of listData.messages) {
    const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
    const msgRes = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!msgRes.ok) continue;

    const msgData = await msgRes.json() as {
      id: string;
      threadId: string;
      labelIds?: string[];
      snippet?: string;
      payload?: {
        headers?: Array<{ name: string; value: string }>;
      };
    };

    const headers = msgData.payload?.headers ?? [];
    const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
    const labels = msgData.labelIds ?? [];

    messages.push({
      id: msgData.id,
      thread_id: msgData.threadId,
      subject: getHeader("Subject"),
      sender: getHeader("From"),
      date: getHeader("Date"),
      labels,
      snippet: msgData.snippet ?? "",
      is_starred: labels.includes("STARRED"),
      is_important: labels.includes("IMPORTANT"),
      html_link: `https://mail.google.com/mail/u/0/#inbox/${msgData.threadId}`,
    });
  }

  return messages;
}

// ─── Cache Sync ───────────────────────────────────────────────────────────

/** Sync a single account's calendar and email data into SQLite cache */
export async function syncAccount(
  db: DatabaseType,
  accountId: string,
  email: string,
  options: {
    timeZone?: string;
  } = {},
): Promise<{ calendar_events_synced: number; emails_synced: number }> {
  const token = getAccessToken(email);
  const now = Date.now();

  // Sync calendar
  const events = await fetchCalendarEvents(token, { timeZone: options.timeZone });

  const upsertEvent = db.prepare(`
    INSERT INTO calendar_events (id, account_id, calendar_id, title, start_time, end_time,
      all_day, attendees, location, description, html_link, rsvp_status, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, start_time=excluded.start_time, end_time=excluded.end_time,
      all_day=excluded.all_day, attendees=excluded.attendees, location=excluded.location,
      description=excluded.description, html_link=excluded.html_link,
      rsvp_status=excluded.rsvp_status, synced_at=excluded.synced_at
  `);

  const deleteStaleEvents = db.prepare(
    "DELETE FROM calendar_events WHERE account_id = ? AND synced_at < ?",
  );

  db.transaction(() => {
    for (const event of events) {
      upsertEvent.run(
        event.id, accountId, event.calendar_id, event.title,
        event.start_time, event.end_time, event.all_day ? 1 : 0,
        JSON.stringify(event.attendees), event.location, event.description,
        event.html_link, event.rsvp_status, now,
      );
    }
    // Remove events that weren't in this sync (cancelled/removed)
    deleteStaleEvents.run(accountId, now);
  })();

  // Sync email
  const emails = await fetchEmails(token, email);

  const upsertEmail = db.prepare(`
    INSERT INTO email_cache (id, account_id, thread_id, subject, sender, date,
      labels, snippet, is_starred, is_important, html_link, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      subject=excluded.subject, sender=excluded.sender, date=excluded.date,
      labels=excluded.labels, snippet=excluded.snippet, is_starred=excluded.is_starred,
      is_important=excluded.is_important, html_link=excluded.html_link, synced_at=excluded.synced_at
  `);

  const pruneOldEmails = db.prepare(
    "DELETE FROM email_cache WHERE account_id = ? AND synced_at < ?",
  );

  db.transaction(() => {
    for (const msg of emails) {
      upsertEmail.run(
        msg.id, accountId, msg.thread_id, msg.subject, msg.sender, msg.date,
        JSON.stringify(msg.labels), msg.snippet, msg.is_starred ? 1 : 0,
        msg.is_important ? 1 : 0, msg.html_link, now,
      );
    }
    pruneOldEmails.run(accountId, now);
  })();

  // Update last_synced_at
  db.prepare("UPDATE external_accounts SET last_synced_at = ? WHERE id = ?").run(now, accountId);

  return { calendar_events_synced: events.length, emails_synced: emails.length };
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/google-api.ts
git commit -m "feat: add Google API client with gcloud auth, Calendar and Gmail REST clients"
```

---

## Task 9: External Account MCP Tools (`tools/external.ts`)

**Files:**
- Create: `plugin/mcp-server/src/tools/external.ts`

- [ ] **Step 1: Create `external.ts` with `account_register` and `account_sync`**

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import { getAccessToken, syncAccount } from "../google-api.js";

/** account_register — register a Google account for syncing */
export function accountRegister(
  db: DatabaseType,
  options: {
    id: string;
    email: string;
    context?: string;
  },
): { id: string; email: string; context: string | null; message: string } | { error: string; message: string } {
  const { id, email, context } = options;

  // Check if account already exists
  const existing = db.prepare("SELECT id FROM external_accounts WHERE id = ?").get(id);
  if (existing) {
    return { error: "account_exists", message: `Account "${id}" already registered. Use a different id.` };
  }

  // Verify gcloud authentication
  try {
    getAccessToken(email);
  } catch (e) {
    return {
      error: "auth_failed",
      message: `Cannot authenticate ${email}. Run: gcloud auth login ${email}\n${e}`,
    };
  }

  db.prepare(
    "INSERT INTO external_accounts (id, provider, account_email, context) VALUES (?, 'google', ?, ?)",
  ).run(id, email, context ?? null);

  return { id, email, context: context ?? null, message: `Account "${id}" (${email}) registered.` };
}

/** account_sync — sync calendar and email data for one or all accounts */
export async function accountSync(
  db: DatabaseType,
  options: {
    id?: string;
    timeZone?: string;
  } = {},
): Promise<{
  accounts: Array<{
    id: string;
    email: string;
    calendar_events_synced: number;
    emails_synced: number;
    error?: string;
  }>;
}> {
  let accounts: Array<{ id: string; account_email: string }>;

  if (options.id) {
    const account = db.prepare("SELECT id, account_email FROM external_accounts WHERE id = ?").get(options.id) as
      { id: string; account_email: string } | undefined;
    if (!account) {
      return { accounts: [{ id: options.id, email: "", calendar_events_synced: 0, emails_synced: 0, error: `Account "${options.id}" not found` }] };
    }
    accounts = [account];
  } else {
    accounts = db.prepare("SELECT id, account_email FROM external_accounts").all() as typeof accounts;
  }

  const results: Array<{
    id: string;
    email: string;
    calendar_events_synced: number;
    emails_synced: number;
    error?: string;
  }> = [];

  for (const account of accounts) {
    try {
      const result = await syncAccount(db, account.id, account.account_email, {
        timeZone: options.timeZone,
      });
      results.push({
        id: account.id,
        email: account.account_email,
        ...result,
      });
    } catch (e) {
      results.push({
        id: account.id,
        email: account.account_email,
        calendar_events_synced: 0,
        emails_synced: 0,
        error: String(e),
      });
    }
  }

  return { accounts: results };
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/tools/external.ts
git commit -m "feat: add account_register and account_sync MCP tools"
```

---

## Task 10: HTTP Sidecar (`http-sidecar.ts`)

**Files:**
- Create: `plugin/mcp-server/src/http-sidecar.ts`

- [ ] **Step 1: Create `http-sidecar.ts`**

```typescript
import { createServer, type Server } from "node:http";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

let server: Server | null = null;
let portFilePath: string | null = null;

export interface SidecarHandlers {
  onSync: () => Promise<void>;
  onRadarItemUpdate: (path: string, state: "resolved" | "active") => void;
}

/** Start the HTTP sidecar on a random port */
export function startSidecar(
  vaultPath: string,
  handlers: SidecarHandlers,
): Promise<number> {
  return new Promise((resolve, reject) => {
    server = createServer(async (req, res) => {
      // CORS headers for local browser access
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        if (req.method === "GET" && req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }

        if (req.method === "POST" && req.url === "/sync") {
          await handlers.onSync();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "synced" }));
          return;
        }

        if (req.method === "POST" && req.url === "/radar/item") {
          const body = await readBody(req);
          const { path, state } = JSON.parse(body);
          if (!path || !state) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing path or state" }));
            return;
          }
          handlers.onRadarItemUpdate(path, state);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "updated", path, state }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        portFilePath = join(vaultPath, ".radar-port");
        writeFileSync(portFilePath, String(port), "utf-8");
        resolve(port);
      } else {
        reject(new Error("Failed to get server address"));
      }
    });

    server.on("error", reject);
  });
}

/** Stop the HTTP sidecar and clean up the port file */
export function stopSidecar(): void {
  if (server) {
    server.close();
    server = null;
  }
  if (portFilePath && existsSync(portFilePath)) {
    try {
      unlinkSync(portFilePath);
    } catch {}
    portFilePath = null;
  }
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/http-sidecar.ts
git commit -m "feat: add HTTP sidecar for radar sync and item update endpoints"
```

---

## Task 11: Radar MCP Tools (`tools/radar.ts`)

**Files:**
- Create: `plugin/mcp-server/src/tools/radar.ts`

This is the largest new file. It renders the daily radar HTML using the design system from `plugin/skills/daily-radar/SKILL.md` and handles item state updates.

- [ ] **Step 1: Create `tools/radar.ts`**

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { accountSync } from "./external.js";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** radar_generate — sync accounts, query all data, render radar HTML */
export async function radarGenerate(
  db: DatabaseType,
  vaultPath: string,
  options: {
    date?: string;
    sidecarPort?: number;
  } = {},
): Promise<{ path: string; tasks_count: number; events_count: number; emails_count: number } | { error: string; message: string }> {
  const date = options.date ?? todayStr();

  // Step 1: Sync all accounts
  try {
    await accountSync(db);
  } catch {
    // Continue even if sync fails — render with whatever cached data exists
  }

  // Step 2: Query data from SQLite
  const overdueTasks = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE tags LIKE '%"task"%' AND status = 'active' AND due IS NOT NULL AND due < ?
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY due ASC
  `).all(date) as Array<TaskRow>;

  const activeTasks = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE tags LIKE '%"task"%' AND status = 'active' AND (due IS NULL OR due >= ?)
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due ASC NULLS LAST
  `).all(date) as Array<TaskRow>;

  const waitingTasks = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE tags LIKE '%"task"%' AND status = 'waiting'
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY due ASC NULLS LAST
  `).all() as Array<TaskRow>;

  const todayEnd = `${date}T23:59:59`;
  const lookaheadEnd = new Date(new Date(date).getTime() + 3 * 86400000).toISOString().slice(0, 10) + "T23:59:59";

  const calendarEvents = db.prepare(`
    SELECT ce.*, ea.account_email, ea.context
    FROM calendar_events ce
    JOIN external_accounts ea ON ce.account_id = ea.id
    WHERE ce.start_time >= ? AND ce.start_time <= ?
    ORDER BY ce.start_time
  `).all(`${date}T00:00:00`, lookaheadEnd) as Array<EventRow>;

  const emailHighlights = db.prepare(`
    SELECT ec.*, ea.account_email, ea.context
    FROM email_cache ec
    JOIN external_accounts ea ON ec.account_id = ea.id
    ORDER BY ec.date DESC LIMIT 20
  `).all() as Array<EmailRow>;

  // Step 3: Read CLAUDE.md for context
  let claudemd = "";
  const claudemdPath = join(vaultPath, "CLAUDE.md");
  if (existsSync(claudemdPath)) {
    try { claudemd = readFileSync(claudemdPath, "utf-8"); } catch {}
  }

  // Step 4: Render HTML
  const html = renderRadarHtml({
    date,
    overdueTasks,
    activeTasks,
    waitingTasks,
    calendarEvents,
    emailHighlights,
    sidecarPort: options.sidecarPort,
  });

  // Step 5: Write file
  const filename = `radar-${date}.html`;
  const outputPath = join(vaultPath, filename);
  writeFileSync(outputPath, html, "utf-8");

  return {
    path: filename,
    tasks_count: overdueTasks.length + activeTasks.length + waitingTasks.length,
    events_count: calendarEvents.length,
    emails_count: emailHighlights.length,
  };
}

/** radar_update_item — modify a single item's visual state in the radar HTML */
export function radarUpdateItem(
  vaultPath: string,
  options: {
    path: string;
    state: "resolved" | "active";
    date?: string;
  },
): { path: string; state: string; updated: boolean } | { error: string; message: string } {
  const date = options.date ?? todayStr();
  const radarFile = join(vaultPath, `radar-${date}.html`);

  if (!existsSync(radarFile)) {
    return { error: "file_not_found", message: `No radar file found for ${date}` };
  }

  let html = readFileSync(radarFile, "utf-8");
  const escapedPath = options.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dataAttr = `data-task-path="${options.path}"`;

  if (!html.includes(dataAttr)) {
    return { error: "item_not_found", message: `No item with path "${options.path}" in radar` };
  }

  if (options.state === "resolved") {
    // Wrap the item content in <s> and add resolved class
    html = html.replace(
      new RegExp(`(<[^>]*${escapedPath}[^>]*class="[^"]*)(")`, "g"),
      `$1 resolved$2`,
    );
    // Add inline style for opacity
    html = html.replace(
      new RegExp(`(<[^>]*${escapedPath}[^>]*style="[^"]*)(")`, "g"),
      `$1 opacity: 0.4;$2`,
    );
    // If no style attr exists, add one
    html = html.replace(
      new RegExp(`(<[^>]*${escapedPath}[^>]*)(?!.*style=)(/?>)`, "g"),
      `$1 style="opacity: 0.4;"$2`,
    );
  } else {
    // Remove resolved class and opacity
    html = html.replace(/ resolved/g, "");
    html = html.replace(/ opacity: 0\.4;/g, "");
  }

  writeFileSync(radarFile, html, "utf-8");
  return { path: options.path, state: options.state, updated: true };
}

// ─── Types ────────────────────────────────────────────────────────────────

interface TaskRow {
  path: string;
  title: string | null;
  priority: string | null;
  due: string | null;
  body_preview: string | null;
  frontmatter_json: string | null;
}

interface EventRow {
  id: string;
  account_id: string;
  calendar_id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  all_day: number;
  attendees: string | null;
  location: string | null;
  description: string | null;
  html_link: string | null;
  rsvp_status: string | null;
  account_email: string;
  context: string | null;
}

interface EmailRow {
  id: string;
  account_id: string;
  thread_id: string;
  subject: string | null;
  sender: string | null;
  date: string | null;
  labels: string | null;
  snippet: string | null;
  is_starred: number;
  is_important: number;
  html_link: string | null;
  account_email: string;
  context: string | null;
}

// ─── HTML Renderer ────────────────────────────────────────────────────────

function renderRadarHtml(data: {
  date: string;
  overdueTasks: TaskRow[];
  activeTasks: TaskRow[];
  waitingTasks: TaskRow[];
  calendarEvents: EventRow[];
  emailHighlights: EmailRow[];
  sidecarPort?: number;
}): string {
  const { date, overdueTasks, activeTasks, waitingTasks, calendarEvents, emailHighlights, sidecarPort } = data;

  const dateLabel = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // Build radar strip items
  const fireItems = buildFireItems(overdueTasks, emailHighlights, activeTasks, date);
  const watchItems = buildWatchItems(activeTasks, waitingTasks, calendarEvents, date);
  const fyiItems = buildFyiItems(emailHighlights);

  // Group calendar events by day
  const eventsByDay = groupEventsByDay(calendarEvents);

  // Group open loops
  const highPriority = activeTasks.filter((t) => t.priority === "high");
  const mediumPriority = activeTasks.filter((t) => t.priority === "medium" || t.priority === "low");

  const portMeta = sidecarPort ? `<meta name="radar-port" content="${sidecarPort}">` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${portMeta}
<title>Daily Radar — ${date}</title>
<style>
:root {
  --bg: #0f1117;
  --surface: #161926;
  --surface2: #1c2035;
  --border: #2e3354;
  --accent: #5c6ef8;
  --accent2: #7b8aff;
  --red: #e05252;
  --orange: #e8933a;
  --yellow: #d4b84a;
  --green: #4caf50;
  --teal: #26a69a;
  --muted: #6b7280;
  --text: #e2e4ed;
  --text2: #9ca3af;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 20px; max-width: 1100px; margin: 0 auto; line-height: 1.5; }
h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.subtitle { font-size: 13px; color: var(--text2); margin-bottom: 20px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; margin-bottom: 20px; }
.card-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); margin-bottom: 14px; display: flex; align-items: center; gap: 6px; }
.card-title .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); display: inline-block; }
a.src { display: inline-flex; align-items: center; font-size: 10px; color: var(--muted); text-decoration: none; opacity: 0.7; margin-left: 5px; border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; gap: 3px; white-space: nowrap; transition: opacity 0.15s, color 0.15s; }
a.src:hover { opacity: 1; color: var(--accent2); border-color: var(--accent2); }
.radar-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 4px; }
@media (max-width: 700px) { .radar-grid { grid-template-columns: 1fr; } }
.radar-item { background: var(--surface2); border-radius: 8px; padding: 12px 14px; border-left: 3px solid var(--border); }
.radar-item.fire { border-left-color: var(--red); }
.radar-item.watch { border-left-color: var(--orange); }
.radar-item.fyi { border-left-color: var(--muted); }
.radar-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
.radar-item.fire .radar-label { color: var(--red); }
.radar-item.watch .radar-label { color: var(--orange); }
.radar-item.fyi .radar-label { color: var(--muted); }
.radar-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 3px; }
.radar-sub { font-size: 11px; color: var(--text2); }
.radar-sources { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 700px) { .two-col { grid-template-columns: 1fr; } }
.schedule-day { margin-bottom: 18px; }
.day-label { font-size: 12px; font-weight: 600; color: var(--accent2); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.timeline { position: relative; padding-left: 16px; }
.timeline::before { content: ''; position: absolute; left: 5px; top: 0; bottom: 0; width: 1px; background: var(--border); }
.event { position: relative; margin-bottom: 8px; background: var(--surface2); border-radius: 7px; padding: 8px 10px; border-left: 3px solid var(--accent); }
.event::before { content: ''; position: absolute; left: -19px; top: 12px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg); }
.event.conflict { border-left-color: var(--orange); }
.event.conflict::before { background: var(--orange); }
.event.personal { border-left-color: var(--teal); }
.event.personal::before { background: var(--teal); }
.event.focus { border-left-color: var(--green); opacity: 0.7; }
.event.focus::before { background: var(--green); }
.event.needs-rsvp { border-left-color: var(--yellow); }
.event.needs-rsvp::before { background: var(--yellow); }
.event.declined { border-left-color: var(--muted); opacity: 0.4; }
.event.declined::before { background: var(--muted); }
.event-time { font-size: 11px; color: var(--muted); margin-bottom: 2px; }
.event-title { font-weight: 600; font-size: 13px; color: var(--text); }
.event-meta { font-size: 11px; color: var(--text2); margin-top: 2px; }
.badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 600; margin-left: 4px; }
.badge-orange { background: rgba(232,147,58,0.2); color: var(--orange); }
.badge-yellow { background: rgba(212,184,74,0.2); color: var(--yellow); }
.badge-red { background: rgba(224,82,82,0.2); color: var(--red); }
.badge-blue { background: rgba(92,110,248,0.2); color: var(--accent2); }
.badge-gray { background: rgba(107,114,128,0.2); color: var(--muted); }
.loop-section { margin-bottom: 14px; }
.loop-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.loop-item { display: flex; align-items: flex-start; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(46,51,84,0.5); }
.loop-item:last-child { border-bottom: none; }
.loop-text { flex: 1; }
.loop-title { font-weight: 500; font-size: 13px; color: var(--text); }
.loop-sub { font-size: 11px; color: var(--text2); margin-top: 1px; }
.priority-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 6px; }
.p-red { background: var(--red); }
.p-orange { background: var(--orange); }
.p-yellow { background: var(--yellow); }
.p-muted { background: var(--muted); }
.legend { display: flex; gap: 20px; flex-wrap: wrap; font-size: 11px; color: var(--muted); margin-top: 4px; align-items: center; }
.legend-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
.resolved { text-decoration: line-through; opacity: 0.4; }
.sync-btn { position: fixed; top: 16px; right: 16px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; color: var(--text2); cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; transition: all 0.15s; z-index: 100; }
.sync-btn:hover { background: var(--accent); color: white; border-color: var(--accent); }
.sync-btn.syncing { opacity: 0.6; pointer-events: none; }
.sync-btn .spinner { display: none; width: 12px; height: 12px; border: 2px solid transparent; border-top-color: currentColor; border-radius: 50%; animation: spin 0.6s linear infinite; }
.sync-btn.syncing .spinner { display: inline-block; }
.sync-btn.syncing .icon { display: none; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>

<button class="sync-btn" onclick="resync()" id="syncBtn">
  <span class="icon">\u21BB</span>
  <span class="spinner"></span>
  Refresh
</button>

<h1>\uD83D\uDCE1 Daily Radar</h1>
<p class="subtitle">${dateLabel}</p>

<!-- RADAR STRIP -->
<div class="card">
  <div class="card-title"><span class="dot"></span> Radar</div>
  <div class="radar-grid">
${fireItems.map((item) => radarItemHtml(item, "fire")).join("\n")}
${watchItems.map((item) => radarItemHtml(item, "watch")).join("\n")}
${fyiItems.map((item) => radarItemHtml(item, "fyi")).join("\n")}
${fireItems.length + watchItems.length + fyiItems.length === 0 ? '    <div class="radar-item fyi"><div class="radar-label">ALL CLEAR</div><div class="radar-title">Nothing urgent</div></div>' : ""}
  </div>
</div>

<div class="two-col">

<!-- SCHEDULE -->
<div class="card">
  <div class="card-title"><span class="dot"></span> Schedule</div>
${Object.entries(eventsByDay).map(([day, events]) => `
  <div class="schedule-day">
    <div class="day-label">${day}</div>
    <div class="timeline">
${events.map((e) => eventHtml(e)).join("\n")}
    </div>
  </div>
`).join("")}
${Object.keys(eventsByDay).length === 0 ? "  <p style=\"color: var(--text2); font-size: 13px;\">No events scheduled</p>" : ""}
</div>

<!-- OPEN LOOPS -->
<div class="card">
  <div class="card-title"><span class="dot"></span> Open Loops</div>
${overdueTasks.length > 0 ? `
  <div class="loop-section">
    <div class="loop-section-title">\uD83D\uDD25 Overdue</div>
${overdueTasks.map((t) => loopItemHtml(t, "p-red")).join("\n")}
  </div>
` : ""}
${highPriority.length > 0 ? `
  <div class="loop-section">
    <div class="loop-section-title">\uD83D\uDFE0 Active — High Priority</div>
${highPriority.map((t) => loopItemHtml(t, "p-orange")).join("\n")}
  </div>
` : ""}
${mediumPriority.length > 0 ? `
  <div class="loop-section">
    <div class="loop-section-title">\uD83D\uDFE1 Active — Medium/Low</div>
${mediumPriority.map((t) => loopItemHtml(t, "p-yellow")).join("\n")}
  </div>
` : ""}
${waitingTasks.length > 0 ? `
  <div class="loop-section">
    <div class="loop-section-title">\u23F3 Waiting For</div>
${waitingTasks.map((t) => loopItemHtml(t, "p-muted")).join("\n")}
  </div>
` : ""}
${overdueTasks.length + activeTasks.length + waitingTasks.length === 0 ? "  <p style=\"color: var(--text2); font-size: 13px;\">No open loops</p>" : ""}
</div>

</div>

<!-- LEGEND -->
<div class="card">
  <div class="legend">
    <span><span class="legend-swatch" style="background:var(--accent)"></span>Meeting</span>
    <span><span class="legend-swatch" style="background:var(--orange)"></span>Conflict</span>
    <span><span class="legend-swatch" style="background:var(--teal)"></span>Personal</span>
    <span><span class="legend-swatch" style="background:var(--green)"></span>Focus</span>
    <span><span class="legend-swatch" style="background:var(--yellow)"></span>Needs RSVP</span>
    <span><span class="legend-swatch" style="background:var(--muted)"></span>Declined</span>
  </div>
</div>

<script>
const PORT = document.querySelector('meta[name="radar-port"]')?.content;

async function resync() {
  if (!PORT) { alert('Start Claude Code to enable sync'); return; }
  const btn = document.getElementById('syncBtn');
  btn.classList.add('syncing');
  try {
    const res = await fetch(\`http://127.0.0.1:\${PORT}/sync\`, { method: 'POST' });
    if (res.ok) location.reload();
    else alert('Sync failed: ' + (await res.text()));
  } catch (e) {
    alert('Cannot reach sync server. Is Claude Code running?');
  } finally {
    btn.classList.remove('syncing');
  }
}
</script>

</body>
</html>`;
}

// ─── Helper Renderers ─────────────────────────────────────────────────────

interface RadarStripItem {
  label: string;
  title: string;
  sub: string;
  sources: string;
  taskPath?: string;
}

function radarItemHtml(item: RadarStripItem, tier: string): string {
  const dataAttr = item.taskPath ? ` data-task-path="${escapeHtml(item.taskPath)}"` : "";
  return `    <div class="radar-item ${tier}"${dataAttr}>
      <div class="radar-label">${item.label}</div>
      <div class="radar-title">${escapeHtml(item.title)}</div>
      <div class="radar-sub">${escapeHtml(item.sub)}</div>
      <div class="radar-sources">${item.sources}</div>
    </div>`;
}

function eventHtml(event: EventRow): string {
  const cssClass = getEventCssClass(event);
  const time = formatEventTime(event);
  const attendeeCount = event.attendees ? JSON.parse(event.attendees).length : 0;
  const meta = [
    attendeeCount > 1 ? `${attendeeCount} attendees` : "",
    event.location ?? "",
  ].filter(Boolean).join(" · ");
  const badges: string[] = [];
  if (event.rsvp_status === "needsAction") badges.push('<span class="badge badge-yellow">RSVP</span>');
  if (event.rsvp_status === "declined") badges.push('<span class="badge badge-gray">DECLINED</span>');

  const link = event.html_link ? `<a class="src" href="${escapeHtml(event.html_link)}" target="_blank">\uD83D\uDCC5 Cal</a>` : "";

  return `      <div class="event ${cssClass}">
        <div class="event-time">${escapeHtml(time)}${badges.join("")}</div>
        <div class="event-title">${escapeHtml(event.title)}${link}</div>
        ${meta ? `<div class="event-meta">${escapeHtml(meta)}</div>` : ""}
      </div>`;
}

function loopItemHtml(task: TaskRow, dotClass: string): string {
  const fm = task.frontmatter_json ? JSON.parse(task.frontmatter_json) : {};
  const dueSub = task.due ? `Due: ${task.due}` : "";
  const waitingOn = fm["waiting-on"] ? `Waiting on: ${fm["waiting-on"]}` : "";
  const sub = [dueSub, waitingOn].filter(Boolean).join(" · ");
  const obsidianLink = `obsidian://open?file=${encodeURIComponent(task.path)}`;

  return `    <div class="loop-item" data-task-path="${escapeHtml(task.path)}">
      <div class="priority-dot ${dotClass}"></div>
      <div class="loop-text">
        <div class="loop-title">${escapeHtml(task.title ?? task.path)}<a class="src" href="${obsidianLink}" target="_blank">\uD83D\uDCD3 tasks</a></div>
        ${sub ? `<div class="loop-sub">${escapeHtml(sub)}</div>` : ""}
      </div>
    </div>`;
}

function buildFireItems(overdue: TaskRow[], emails: EmailRow[], active: TaskRow[], date: string): RadarStripItem[] {
  const items: RadarStripItem[] = [];

  for (const task of overdue) {
    const daysOverdue = Math.ceil((new Date(date).getTime() - new Date(task.due!).getTime()) / 86400000);
    items.push({
      label: "\uD83D\uDD25 FIRE",
      title: task.title ?? task.path,
      sub: `${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue`,
      sources: `<a class="src" href="obsidian://open?file=${encodeURIComponent(task.path)}" target="_blank">\uD83D\uDCD3 tasks</a>`,
      taskPath: task.path,
    });
  }

  // Due-today tasks
  for (const task of active.filter((t) => t.due === date)) {
    items.push({
      label: "\uD83D\uDD25 FIRE",
      title: task.title ?? task.path,
      sub: "Due today",
      sources: `<a class="src" href="obsidian://open?file=${encodeURIComponent(task.path)}" target="_blank">\uD83D\uDCD3 tasks</a>`,
      taskPath: task.path,
    });
  }

  // Starred emails
  for (const email of emails.filter((e) => e.is_starred)) {
    items.push({
      label: "\uD83D\uDD25 FIRE",
      title: email.subject ?? "(No subject)",
      sub: `From: ${email.sender ?? "unknown"}`,
      sources: email.html_link ? `<a class="src" href="${escapeHtml(email.html_link)}" target="_blank">\uD83D\uDCE7 Gmail</a>` : "",
    });
  }

  return items;
}

function buildWatchItems(active: TaskRow[], waiting: TaskRow[], events: EventRow[], date: string): RadarStripItem[] {
  const items: RadarStripItem[] = [];

  // High priority tasks due within 7 days
  const weekOut = new Date(new Date(date).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  for (const task of active.filter((t) => t.priority === "high" && t.due && t.due > date && t.due <= weekOut)) {
    items.push({
      label: "\uD83D\uDC40 WATCH",
      title: task.title ?? task.path,
      sub: `Due: ${task.due}`,
      sources: `<a class="src" href="obsidian://open?file=${encodeURIComponent(task.path)}" target="_blank">\uD83D\uDCD3 tasks</a>`,
      taskPath: task.path,
    });
  }

  // Stale waiting-for items (>7 days)
  for (const task of waiting) {
    const fm = task.frontmatter_json ? JSON.parse(task.frontmatter_json) : {};
    const waitingSince = fm["waiting-since"];
    if (waitingSince) {
      const days = Math.ceil((new Date(date).getTime() - new Date(waitingSince).getTime()) / 86400000);
      if (days >= 7) {
        items.push({
          label: "\uD83D\uDC40 WATCH",
          title: task.title ?? task.path,
          sub: `Waiting ${days} days on ${fm["waiting-on"] ?? "someone"}`,
          sources: `<a class="src" href="obsidian://open?file=${encodeURIComponent(task.path)}" target="_blank">\uD83D\uDCD3 tasks</a>`,
          taskPath: task.path,
        });
      }
    }
  }

  // Events needing RSVP
  for (const event of events.filter((e) => e.rsvp_status === "needsAction")) {
    items.push({
      label: "\uD83D\uDC40 WATCH",
      title: event.title,
      sub: `Needs RSVP · ${formatEventTime(event)}`,
      sources: event.html_link ? `<a class="src" href="${escapeHtml(event.html_link)}" target="_blank">\uD83D\uDCC5 Cal</a>` : "",
    });
  }

  return items;
}

function buildFyiItems(emails: EmailRow[]): RadarStripItem[] {
  // Non-starred important emails
  return emails.filter((e) => e.is_important && !e.is_starred).slice(0, 3).map((email) => ({
    label: "\u2139\uFE0F FYI",
    title: email.subject ?? "(No subject)",
    sub: `From: ${email.sender ?? "unknown"}`,
    sources: email.html_link ? `<a class="src" href="${escapeHtml(email.html_link)}" target="_blank">\uD83D\uDCE7 Gmail</a>` : "",
  }));
}

function groupEventsByDay(events: EventRow[]): Record<string, EventRow[]> {
  const groups: Record<string, EventRow[]> = {};
  for (const event of events) {
    const day = event.start_time.slice(0, 10);
    const label = new Date(day + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "long", month: "short", day: "numeric",
    });
    if (!groups[label]) groups[label] = [];
    groups[label].push(event);
  }
  return groups;
}

function getEventCssClass(event: EventRow): string {
  if (event.rsvp_status === "declined") return "declined";
  if (event.rsvp_status === "needsAction") return "needs-rsvp";
  if (event.context === "personal") return "personal";
  const titleLower = (event.title ?? "").toLowerCase();
  if (titleLower.includes("focus") || titleLower.includes("block")) return "focus";
  return "";
}

function formatEventTime(event: EventRow): string {
  if (event.all_day) return "All day";
  const start = new Date(event.start_time);
  const end = event.end_time ? new Date(event.end_time) : null;
  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return end ? `${fmt(start)} — ${fmt(end)}` : fmt(start);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/tools/radar.ts
git commit -m "feat: add radar_generate and radar_update_item MCP tools with full HTML renderer"
```

---

## Task 12: Wire Everything into `index.ts`

**Files:**
- Modify: `plugin/mcp-server/src/index.ts`

- [ ] **Step 1: Update `index.ts` — add imports, init SQLite, start sidecar, register new tools**

Replace the entire `plugin/mcp-server/src/index.ts` with the updated version. Key changes:

Add these imports after the existing imports:

```typescript
import { openDatabase, closeDatabase, getDatabase } from "./index-db.js";
import { runSync, reindexFile } from "./sync.js";
import { startSidecar, stopSidecar } from "./http-sidecar.js";
import { accountRegister, accountSync } from "./tools/external.js";
import { radarGenerate, radarUpdateItem } from "./tools/radar.js";
```

After `const vaultPath = resolveVaultPath();`, add SQLite initialization:

```typescript
// Initialize SQLite index
let db: import("better-sqlite3").Database | null = null;
let sidecarPort: number | undefined;

if (vaultPath) {
  try {
    db = openDatabase(vaultPath);
    const syncResult = runSync(db, vaultPath);
    console.error(`Vault sync: ${syncResult.mode}, added=${syncResult.added}, updated=${syncResult.updated}, deleted=${syncResult.deleted}`);
  } catch (e) {
    console.error("SQLite init failed, continuing without index:", e);
    db = null;
  }

  // Start HTTP sidecar
  try {
    startSidecar(vaultPath, {
      onSync: async () => {
        if (db) {
          await accountSync(db);
          await radarGenerate(db, vaultPath, { sidecarPort });
        }
      },
      onRadarItemUpdate: (path, state) => {
        radarUpdateItem(vaultPath, { path, state });
      },
    }).then((port) => {
      sidecarPort = port;
      console.error(`HTTP sidecar listening on port ${port}`);
    }).catch((e) => {
      console.error("HTTP sidecar failed to start:", e);
    });
  } catch (e) {
    console.error("HTTP sidecar setup failed:", e);
  }
}
```

Update existing tool registrations to pass `db` where needed. For example, the `task_list` registration becomes:

```typescript
server.tool(
  "task_list",
  "List task notes with frontmatter, optionally filtered by status, priority, context, project, or due date range.",
  { /* ... same schema ... */ },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(taskList(requireVault(), params, db ?? undefined), null, 2) }],
  }),
);
```

Apply the same `db` pass-through for:
- `note_search` → `noteSearch(requireVault(), params, db ?? undefined)`
- `task_create` → `taskCreate(requireVault(), params, db ?? undefined)`
- `task_update` → `taskUpdate(requireVault(), path, { frontmatter, append_body, replace_section }, db ?? undefined)`
- `task_complete` → `taskComplete(requireVault(), path, db ?? undefined)`
- `memory_read` → `memoryRead(requireVault(), params, db ?? undefined)`
- `memory_write` → `memoryWrite(requireVault(), path, options, db ?? undefined)`
- `wikilink_consolidate` → `wikilinkConsolidate(requireVault(), name, dry_run, db ?? undefined)`
- `wikilink_validate` → `wikilinkValidate(requireVault(), directory, fix_suggestions, db ?? undefined)`

Add re-index hook for `note_write`:

```typescript
server.tool(
  "note_write",
  /* ... same ... */
  async ({ path, ...options }) => {
    const result = noteWrite(requireVault(), path, options);
    if (!("error" in result) && db && path.endsWith(".md")) {
      reindexFile(db, requireVault(), path);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);
```

Add the 4 new tool registrations after Group 7:

```typescript
// ─── Group 8: External Accounts ───────────────────────────────────────────

server.tool(
  "account_register",
  "Register a Google account for calendar and email syncing. Requires gcloud CLI authentication.",
  {
    id: z.string().describe("Short label for the account, e.g. 'work', 'personal'"),
    email: z.string().describe("Google account email address"),
    context: z.string().optional().describe("Context label: 'work' or 'personal'"),
  },
  async (params) => {
    if (!db) return { content: [{ type: "text", text: JSON.stringify({ error: "no_database", message: "SQLite not initialized" }) }] };
    return { content: [{ type: "text", text: JSON.stringify(accountRegister(db, params), null, 2) }] };
  },
);

server.tool(
  "account_sync",
  "Sync calendar events and email from registered Google accounts into the local cache.",
  {
    id: z.string().optional().describe("Sync a specific account by id, or omit to sync all"),
    timeZone: z.string().optional().describe("IANA timezone, e.g. 'America/New_York'"),
  },
  async (params) => {
    if (!db) return { content: [{ type: "text", text: JSON.stringify({ error: "no_database", message: "SQLite not initialized" }) }] };
    const result = await accountSync(db, params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// ─── Group 9: Radar ───────────────────────────────────────────────────────

server.tool(
  "radar_generate",
  "Generate daily radar HTML briefing. Syncs all accounts first, then renders tasks, calendar, and email into a single HTML file.",
  {
    date: z.string().optional().describe("Date in YYYY-MM-DD format (default: today)"),
  },
  async ({ date }) => {
    if (!db) return { content: [{ type: "text", text: JSON.stringify({ error: "no_database", message: "SQLite not initialized" }) }] };
    const result = await radarGenerate(db, requireVault(), { date, sidecarPort });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "radar_update_item",
  "Update a single item's visual state in today's radar HTML (strikethrough for resolved, restore for active).",
  {
    path: z.string().describe("Vault-relative path to the task, e.g. 'tasks/review-budget.md'"),
    state: z.enum(["resolved", "active"]).describe("Visual state to apply"),
    date: z.string().optional().describe("Radar date (default: today)"),
  },
  async ({ path, state, date }) => ({
    content: [{ type: "text", text: JSON.stringify(radarUpdateItem(requireVault(), { path, state, date }), null, 2) }],
  }),
);
```

Update the `main` function to handle shutdown:

```typescript
async function main() {
  const transport = new StdioServerTransport();

  // Graceful shutdown
  const shutdown = () => {
    stopSidecar();
    closeDatabase();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation with no errors.

- [ ] **Step 3: Smoke test — start the server**

```bash
cd plugin/mcp-server && echo '{}' | timeout 3 node dist/index.js /tmp/test-vault 2>&1 || true
```

Expected: Should print vault sync output to stderr and not crash. The `/tmp/test-vault` doesn't need to exist — it will log a warning and continue.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/src/index.ts
git commit -m "feat: wire SQLite, sync, HTTP sidecar, and new tools into MCP server startup"
```

---

## Task 13: End-to-End Verification

- [ ] **Step 1: Clean build from scratch**

```bash
cd plugin/mcp-server && rm -rf dist && npm run build
```

Expected: Clean compilation.

- [ ] **Step 2: Verify the dev mode starts**

```bash
cd plugin/mcp-server && timeout 3 npx tsx src/index.ts 2>&1 || true
```

Expected: Should print vault sync output (or warning about no vault) to stderr without crashing.

- [ ] **Step 3: Verify .gitignore additions**

```bash
cat .gitignore
```

Expected: Contains `.vault-index.db`, `.vault-index.db-wal`, `.vault-index.db-shm`, `.radar-port` entries.

- [ ] **Step 4: Final commit with version bump**

Update the version in `plugin/mcp-server/package.json` from `0.7.0` to `0.8.0` and in `plugin/mcp-server/src/index.ts` the server version.

```bash
git add -A
git commit -m "feat: SP1 complete — SQLite index, Google auth, radar tools (v0.8.0)"
```
