import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

const DB_FILENAME = ".vault-index.db";
const SCHEMA_VERSION = 2;

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
  }
  if (currentVersion < 2) {
    migrateV2(db);
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
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

function migrateV2(db: DatabaseType): void {
  db.exec(`
    ALTER TABLE external_accounts ADD COLUMN refresh_token TEXT;
  `);
}
