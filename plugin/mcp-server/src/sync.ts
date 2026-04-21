import type { Database as DatabaseType, Statement } from "better-sqlite3";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { parseNote } from "./frontmatter.js";
import { extractWikilinks } from "./wikilinks.js";

/** Cached prepared statements for reindexFile (lazy-initialized per db instance) */
let cachedDb: DatabaseType | null = null;
let stmts: {
  upsertNote: Statement;
  deleteFts: Statement;
  insertFts: Statement;
  deleteLinks: Statement;
  insertLink: Statement;
  deleteFtsForRemove: Statement;
  deleteLinksForRemove: Statement;
  deleteNote: Statement;
} | null = null;

function extractLinkTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/);
  if (match) return match[1].trim() || null;
  const cleaned = value.trim();
  return cleaned || null;
}

function computeDerivedFields(fm: Record<string, unknown>): {
  projectSlug: string | null;
  assignedToSlug: string | null;
  isTask: number;
} {
  const projectSlug = extractLinkTarget(fm.project);
  const assignedToSlug = extractLinkTarget(fm["assigned-to"]);
  const tags = Array.isArray(fm.tags) ? fm.tags : [];
  const isTask = tags.includes("task") ? 1 : 0;
  return { projectSlug, assignedToSlug, isTask };
}

function getStatements(db: DatabaseType) {
  if (cachedDb === db && stmts) return stmts;
  cachedDb = db;
  stmts = {
    upsertNote: db.prepare(`
      INSERT INTO notes (path, title, tags, status, priority, due, context, project,
        assigned_to, project_slug, assigned_to_slug, is_task, area, created, modified_at, content_hash, body_preview, frontmatter_json)
      VALUES (@path, @title, @tags, @status, @priority, @due, @context, @project,
        @assigned_to, @project_slug, @assigned_to_slug, @is_task, @area, @created, @modified_at, @content_hash, @body_preview, @frontmatter_json)
      ON CONFLICT(path) DO UPDATE SET
        title=excluded.title, tags=excluded.tags, status=excluded.status,
        priority=excluded.priority, due=excluded.due, context=excluded.context,
        project=excluded.project, assigned_to=excluded.assigned_to,
        project_slug=excluded.project_slug, assigned_to_slug=excluded.assigned_to_slug,
        is_task=excluded.is_task, area=excluded.area,
        created=excluded.created, modified_at=excluded.modified_at,
        content_hash=excluded.content_hash, body_preview=excluded.body_preview,
        frontmatter_json=excluded.frontmatter_json
    `),
    deleteFts: db.prepare("DELETE FROM notes_fts WHERE rowid = (SELECT rowid FROM notes WHERE path = ?)"),
    insertFts: db.prepare("INSERT INTO notes_fts (rowid, title, body) VALUES ((SELECT rowid FROM notes WHERE path = ?), ?, ?)"),
    deleteLinks: db.prepare("DELETE FROM wikilinks WHERE source_path = ?"),
    insertLink: db.prepare("INSERT OR IGNORE INTO wikilinks (source_path, target_slug, display_text) VALUES (?, ?, ?)"),
    deleteFtsForRemove: db.prepare("DELETE FROM notes_fts WHERE rowid = (SELECT rowid FROM notes WHERE path = ?)"),
    deleteLinksForRemove: db.prepare("DELETE FROM wikilinks WHERE source_path = ?"),
    deleteNote: db.prepare("DELETE FROM notes WHERE path = ?"),
  };
  return stmts;
}

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

/** Coerce a frontmatter value to a string safe for SQLite binding.
 *  gray-matter parses YAML dates as Date objects — SQLite can only bind
 *  strings, numbers, bigints, buffers, and null. */
function fmStr(val: unknown): string | null {
  if (val == null) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === "string") return val;
  return String(val);
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
  const derived = computeDerivedFields(fm);

  return {
    path: filePath,
    title: fmStr(fm.title),
    tags: Array.isArray(fm.tags) ? JSON.stringify(fm.tags) : null,
    status: fmStr(fm.status),
    priority: fmStr(fm.priority),
    due: fmStr(fm.due),
    context: fmStr(fm.context),
    project: fmStr(fm.project),
    assigned_to: fmStr(fm["assigned-to"]),
    project_slug: derived.projectSlug,
    assigned_to_slug: derived.assignedToSlug,
    is_task: derived.isTask,
    area: fmStr(fm.area),
    created: fmStr(fm.created),
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
  preloaded?: { content: string; mtime: number },
): void {
  const fullPath = join(vaultPath, filePath);
  let content: string;
  let mtime: number;
  try {
    if (preloaded) {
      content = preloaded.content;
      mtime = preloaded.mtime;
    } else {
      content = readFileSync(fullPath, "utf-8");
      mtime = statSync(fullPath).mtimeMs;
    }
  } catch {
    removeFile(db, filePath);
    return;
  }

  const row = extractNoteRow(filePath, content, mtime);
  const links = extractWikilinks(content);
  const s = getStatements(db);

  const transaction = db.transaction(() => {
    s.upsertNote.run({
      path: row.path, title: row.title, tags: row.tags, status: row.status,
      priority: row.priority, due: row.due, context: row.context, project: row.project,
      assigned_to: row.assigned_to, project_slug: row.project_slug,
      assigned_to_slug: row.assigned_to_slug, is_task: row.is_task,
      area: row.area, created: row.created,
      modified_at: row.modified_at, content_hash: row.content_hash,
      body_preview: row.body_preview, frontmatter_json: row.frontmatter_json,
    });
    s.deleteFts.run(row.path);
    s.insertFts.run(row.path, row.title ?? "", row.body);
    s.deleteLinks.run(row.path);
    for (const link of links) {
      const targetSlug = link.target.split("#")[0].trim();
      if (targetSlug) {
        s.insertLink.run(row.path, targetSlug, link.display ?? "");
      }
    }
  });

  transaction();
}

/** Remove a file from the index */
function removeFile(db: DatabaseType, filePath: string): void {
  const s = getStatements(db);
  const transaction = db.transaction(() => {
    s.deleteFtsForRemove.run(filePath);
    s.deleteLinksForRemove.run(filePath);
    s.deleteNote.run(filePath);
  });

  transaction();
}

/** Full scan — index every .md file in the vault */
export function fullScan(db: DatabaseType, vaultPath: string): { indexed: number } {
  const files = walkVault(vaultPath);

  const upsertNote = db.prepare(`
    INSERT INTO notes (path, title, tags, status, priority, due, context, project,
      assigned_to, project_slug, assigned_to_slug, is_task, area, created, modified_at, content_hash, body_preview, frontmatter_json)
    VALUES (@path, @title, @tags, @status, @priority, @due, @context, @project,
      @assigned_to, @project_slug, @assigned_to_slug, @is_task, @area, @created, @modified_at, @content_hash, @body_preview, @frontmatter_json)
    ON CONFLICT(path) DO UPDATE SET
      title=excluded.title, tags=excluded.tags, status=excluded.status,
      priority=excluded.priority, due=excluded.due, context=excluded.context,
      project=excluded.project, assigned_to=excluded.assigned_to,
      project_slug=excluded.project_slug, assigned_to_slug=excluded.assigned_to_slug,
      is_task=excluded.is_task, area=excluded.area,
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
        project_slug: row.project_slug,
        assigned_to_slug: row.assigned_to_slug,
        is_task: row.is_task,
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
          reindexFile(db, vaultPath, filePath, { content, mtime });
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
