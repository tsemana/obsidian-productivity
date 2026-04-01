# Architecture Recommendation: Obsidian Productivity Plugin Evolution

**Date:** 2026-03-29 (revised 2026-03-29)
**Authors:** AI Expert Team (Productivity Coach, Software Architect, UX Expert)
**Status:** Approved — revised with daily-radar integration

---

## Executive Summary

**Keep flat markdown files as the source of truth. Add a SQLite sidecar index for fast queries, composite MCP tools for common workflows, and an external data cache for multi-account calendar/email. Add new workflow commands (/morning, /review) and an inbox capture system. Defer RAG/semantic search to Phase 3.**

The architecture preserves everything that works (Obsidian-native, human-readable, git-versioned, portable files) while solving the actual pain points (slow search, chatty MCP round-trips, missing productivity rituals, multi-account access).

---

## 1. Current System Assessment

### Strengths (preserve these)

1. **Everything is a file** — human-readable, git-versioned, portable. No vendor lock-in.
2. **Obsidian as UI** — graph view, community plugins, mobile app. Don't replace.
3. **Two-tier memory** — CLAUDE.md hot cache + deep memory directory. Elegant for LLM context windows.
4. **Wikilinks as knowledge graph** — `[[slug|Display Name]]` creates genuine interconnections without a graph database.
5. **Memory shorthand decoder** — the "ask todd about the PSR for phoenix" → full context expansion. This is the product moat.
6. **MCP tool architecture** — clean separation of concerns, Zod schemas, path traversal prevention.

### Productivity Framework Grades

| Framework | Grade | Key Gap |
|-----------|-------|---------|
| GTD (Getting Things Done) | B+ | No Weekly Review ritual, no inbox concept |
| PARA Method | B- | No Areas of Responsibility, projects buried in memory/ |
| Building a Second Brain | B | No progressive summarization, no distillation workflow |
| Zettelkasten | A- | Strongest alignment — atomic notes, rich linking |

### Technical Weaknesses

- **No indexing** — `note_search` does O(n) full file reads with substring matching
- **No semantic search** — only exact/substring text matching
- **No aggregation** — can't answer "how many tasks per project?" without reading every file
- **Chatty MCP** — common workflows require 4-8 sequential tool calls
- **Scale ceiling** — system degrades around 2,000-3,000 notes
- **Manual memory maintenance** — CLAUDE.md promotion/demotion is invisible labor

### UX Friction Points

1. **Pull-based updates** — user must remember to run `/update`; system should come to the user
2. **Capture friction** — adding a thought requires opening Claude or Obsidian; no quick-dump path
3. **AI-human info gap** — CLAUDE.md optimized for AI, Bases for humans; neither gets a perfect view
4. **Memory staleness** — no trigger for promotion/demotion; hot cache drifts over time
5. **Multi-account auth** — dual-context system doesn't solve the OAuth juggling problem

---

## 2. Recommended Architecture

### What Won

**"Enhanced Flat Files with SQLite Index, Composite MCP Tools, and External Data Cache"**

- Flat `.md` files remain source of truth — human-readable, git-versioned, Obsidian-native, portable
- SQLite sidecar (`.vault-index.db`, gitignored) provides indexed queries, FTS5 full-text search, wikilink graph traversal
- Composite MCP tools reduce round-trips from 4-8 to 1 per workflow
- External data cache in SQLite solves multi-account calendar/email
- New workflow commands (`/morning`, `/review`) implement GTD rituals the system currently lacks
- Inbox folder pattern for low-friction thought capture
- RAG layer (Ollama + sqlite-vec) deferred to Phase 3 when vault exceeds ~2,000 notes

### What Lost and Why

| Option | Verdict |
|---|---|
| **PostgreSQL/MySQL backend** | REJECTED (unanimous). Two-way sync with Obsidian vault is an engineering sinkhole. Breaks "everything is a file" value proposition. Requires Docker or managed DB — unacceptable for personal productivity. At personal scale (<10K notes), SQLite handles every query PostgreSQL would. |
| **Purpose-built (no Obsidian)** | REJECTED. Throws away Obsidian's ecosystem (graph view, 1,500+ community plugins, mobile app, sync). Building a UI from scratch is months of work for an inferior result. |
| **Workflow fixes only (no architecture)** | REJECTED. Composite tools without an index are just slow monolithic calls. The index and the workflows are interdependent. |
| **Full RAG from day one** | REJECTED. Premature complexity. FTS5 handles 95% of search needs under 2K notes. Embedding infrastructure adds operational burden for marginal benefit at current scale. |

### Tech Stack

```
Runtime:        Node.js (TypeScript) — unchanged
Data store:     Flat .md files (source of truth) + SQLite via better-sqlite3 (read index)
Search:         FTS5 full-text → Phase 3: sqlite-vec + Ollama nomic-embed-text (semantic)
Transport:      MCP over stdio — unchanged
External data:  Google Calendar/Gmail MCP connectors → cached in SQLite
Scheduling:     Claude Code CronCreate for automated daily briefing
UI:             Obsidian — unchanged
```

### Vault Structure (new additions marked)

```
obsidian-vault/
├── .vault-index.db           ← NEW: SQLite sidecar (gitignored, auto-rebuilt)
├── CLAUDE.md                 ← Hot cache (Phase 2: auto-maintained from reference frequency)
├── inbox/                    ← NEW: unprocessed captures
├── tasks/                    ← Active tasks (individual .md files)
│   └── done/                 ← Completed tasks
├── daily/                    ← Daily notes (auto-generated via cron + user additions)
├── references/               ← Web clips, meeting notes, documents
├── memory/
│   ├── people/               ← Person profiles
│   ├── projects/             ← Project notes
│   ├── areas/                ← NEW: PARA Areas of Responsibility
│   ├── context/              ← Company/team context
│   └── glossary.md           ← Full decoder ring
├── templates/
├── bases/
└── canvas/
```

---

## 3. SQLite Schema

```sql
-- Core index of all vault files
CREATE TABLE notes (
  path TEXT PRIMARY KEY,
  title TEXT,
  tags TEXT,              -- JSON array
  status TEXT,
  priority TEXT,
  due TEXT,
  context TEXT,
  project TEXT,
  assigned_to TEXT,
  area TEXT,              -- PARA area link
  created TEXT,
  modified_at INTEGER,    -- file mtime for incremental re-index
  content_hash TEXT,      -- detect content changes
  body_preview TEXT,      -- first 500 chars
  frontmatter_json TEXT   -- full frontmatter as JSON for arbitrary queries
);

-- Full-text search
CREATE VIRTUAL TABLE notes_fts USING fts5(
  path, title, body,
  content='notes',
  tokenize='porter unicode61'
);

-- Wikilink graph
CREATE TABLE wikilinks (
  source_path TEXT REFERENCES notes(path) ON DELETE CASCADE,
  target_slug TEXT,
  display_text TEXT,
  PRIMARY KEY (source_path, target_slug, display_text)
);

-- Reference frequency for auto-promotion/demotion
CREATE TABLE reference_log (
  path TEXT,
  referenced_at INTEGER,
  context TEXT             -- 'search', 'briefing', 'review', 'manual'
);

-- External data cache: accounts
CREATE TABLE external_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_email TEXT NOT NULL,
  context TEXT,
  last_synced_at INTEGER
);

-- External data cache: calendar
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES external_accounts(id),
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  attendees TEXT,
  location TEXT,
  description TEXT,
  synced_at INTEGER
);

-- External data cache: email
CREATE TABLE email_cache (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES external_accounts(id),
  thread_id TEXT,
  subject TEXT,
  sender TEXT,
  date TEXT,
  labels TEXT,
  snippet TEXT,
  synced_at INTEGER
);

-- Indexes
CREATE INDEX idx_notes_status ON notes(status);
CREATE INDEX idx_notes_due ON notes(due);
CREATE INDEX idx_notes_context ON notes(context);
CREATE INDEX idx_notes_project ON notes(project);
CREATE INDEX idx_wikilinks_target ON wikilinks(target_slug);
CREATE INDEX idx_calendar_time ON calendar_events(start_time);
CREATE INDEX idx_email_date ON email_cache(date);
CREATE INDEX idx_reflog_path ON reference_log(path, referenced_at);
```

---

## 4. Composite MCP Tools

### `morning_briefing`

Single call returns: today's calendar (from cache), overdue tasks with next actions (first unchecked subtask), stale waiting-fors, inbox count, email highlights, CLAUDE.md context.

```typescript
server.tool("morning_briefing", "Generate morning briefing data", {}, async () => {
  const tasks = taskList(vault, { status: ["active", "waiting"], due_before: tomorrow() });
  const hotCache = claudemdRead(vault);

  // Per-project next actions
  const activeProjects = db.prepare(`
    SELECT n.path, n.title, n.frontmatter_json
    FROM notes n
    WHERE n.tags LIKE '%project%'
    AND json_extract(n.frontmatter_json, '$.status') IN ('active', 'in-progress')
  `).all();

  const nextActions = [];
  for (const project of activeProjects) {
    const projectSlug = project.path.split('/').pop()?.replace('.md', '') ?? '';
    const nextTask = db.prepare(`
      SELECT n.path, n.title, n.priority, n.due, n.body_preview
      FROM notes n
      WHERE n.status = 'active' AND n.project LIKE ?
      ORDER BY
        CASE n.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        n.due ASC NULLS LAST
      LIMIT 1
    `).get(`%${projectSlug}%`);

    if (nextTask) {
      const uncheckedMatch = nextTask.body_preview?.match(/- \[ \] (.+)/);
      nextActions.push({
        project: project.title,
        next_action: uncheckedMatch ? uncheckedMatch[1] : nextTask.title,
        path: nextTask.path
      });
    }
  }

  // Calendar from cache (all accounts)
  const todayEvents = db.prepare(`
    SELECT ce.*, ea.account_email, ea.context
    FROM calendar_events ce
    JOIN external_accounts ea ON ce.account_id = ea.id
    WHERE ce.start_time >= date('now') AND ce.start_time < date('now', '+1 day')
    ORDER BY ce.start_time
  `).all();

  // Email highlights from cache
  const emailHighlights = db.prepare(`
    SELECT ec.*, ea.account_email, ea.context
    FROM email_cache ec
    JOIN external_accounts ea ON ec.account_id = ea.id
    WHERE ec.date >= date('now', '-2 days')
    ORDER BY ec.date DESC LIMIT 10
  `).all();

  return {
    date: today(),
    tasks: { active: activeTasks, overdue: overdueTasks },
    next_actions: nextActions,
    calendar: todayEvents,
    email: emailHighlights,
    waiting: staleWaiting,
    inbox_count: inboxCount,
    memory: hotCache
  };
});
```

### `quick_capture`

Two-mode capture: structured tasks go directly to `tasks/`, ambiguous thoughts go to `inbox/`.

```typescript
server.tool("quick_capture", "Capture a thought — writes structured task or raw inbox item", {
  thought: z.string(),
  hint: z.enum(["task", "idea", "reference", "unknown"]).optional(),
}, async ({ thought, hint = "unknown" }) => {
  if (hint === "task") {
    const slug = slugify(thought.slice(0, 50));
    return taskCreate(vault, { title: thought, status: "active", priority: "medium", filename: slug });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = slugify(thought.slice(0, 50));
  const path = `inbox/${timestamp}-${slug}.md`;

  const possibleLinks = db.prepare(
    "SELECT path, title FROM notes_fts WHERE notes_fts MATCH ? LIMIT 5"
  ).all(extractKeywords(thought));

  const frontmatter = {
    captured: new Date().toISOString(),
    hint,
    processed: false,
    ...(possibleLinks.length > 0 ? { suggested_links: possibleLinks.map(l => l.path) } : {})
  };

  noteWrite(vault, path, { frontmatter, body: `# ${thought}\n` });
  return { path, hint, suggested_links: possibleLinks, message: `Captured to inbox.` };
});
```

### `project_overview`

Aggregates project note, linked tasks, people, recent activity in one call.

```typescript
server.tool("project_overview", "Get holistic project view", {
  project: z.string()
}, async ({ project }) => {
  const projectNote = memoryRead(vault, { search: project, type: "project" });
  const tasks = db.prepare(`SELECT * FROM notes WHERE project LIKE ? ORDER BY status, priority`).all(`%${project}%`);
  const links = db.prepare(`SELECT * FROM wikilinks WHERE source_path LIKE ? OR target_slug LIKE ?`).all(`%${project}%`, `%${project}%`);
  const recentMentions = db.prepare(`SELECT path, title FROM notes_fts WHERE notes_fts MATCH ? LIMIT 10`).all(project);
  return { project: projectNote, tasks, connections: links, recent: recentMentions };
});
```

### `weekly_review`

Returns all data needed for the GTD Weekly Review in one call.

### `search_and_summarize`

FTS5 query with ranked results and context snippets for Claude to synthesize.

---

## 5. Resolved Debates

| Debate | Resolution | Rationale |
|---|---|---|
| **Sequencing** | Workflow commands AND SQLite index ship together in Phase 1 | The index makes composite tools fast; composite tools power the workflows. They're interdependent. |
| **Inbox processing** | User-triggered only, with contextual nudges | GTD: capture and clarify are separate steps. During `/review`, Claude walks through unprocessed items. Never auto-categorize. Trust > speed. |
| **Daily briefing** | Pre-generated (cron) + real-time fallback (`/morning`) | Cron creates `daily/YYYY-MM-DD.md` as ambient artifact. `/morning` provides interactive alternative. Both use `morning_briefing` composite tool. |
| **Push vs control** | Ambient artifacts + contextual nudges, never interrupting | Daily note appears silently in Obsidian. Nudges during `/morning`: "3 inbox items waiting." No notifications. User pulls when ready. |
| **RAG timing** | Phase 3, triggered by vault size (~2K notes) or search quality issues | FTS5 with porter stemming handles 95% under 2K notes. Premature RAG adds Ollama dependency for marginal benefit. |
| **Multi-account auth** | Local SQLite cache per account, per-session sync, cross-account queries from cache | Accept 6-24h staleness for non-active account. Platform constraint we can't change. |
| **Areas of Responsibility** | `memory/areas/` folder with individual area notes | Area notes are rich: frontmatter, body, wikilinks to projects. Tags are flat and can't participate in the link graph. |

---

## 6. Multi-Account Calendar/Gmail Solution

### The Problem

MCP connector OAuth authenticates one Google account per session. No API for stored refresh tokens or multi-account in a single session.

### The Solution: Cache-and-Bridge Pattern

```
Session A (work account):
  → Authenticated to work@company.com
  → sync_external pulls work calendar + work email → SQLite
  → Can READ personal data from cache (stale but available)

Session B (personal account):
  → Authenticated to personal@gmail.com
  → sync_external pulls personal calendar + personal email → SQLite
  → Can READ work data from cache (stale but available)

Morning briefing (either session):
  → Queries ALL cached accounts from SQLite
  → Shows combined view with freshness indicators
```

### Cache Freshness Model

| Freshness | Age | Behavior |
|---|---|---|
| **fresh** | <6h (calendar) / <4h (email) | Use cached data, no indicator |
| **stale** | 6-24h (calendar) / 4-12h (email) | Use cached data, show "last synced X hours ago" |
| **expired** | >24h (calendar) / >12h (email) | Show with warning, attempt live sync if connector available |

---

## 7. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

#### Week 1: SQLite Index + Tool Refactoring

**New files:**
- `plugin/mcp-server/src/index-db.ts` — SQLite schema, connection management, query helpers
- `plugin/mcp-server/src/sync.ts` — Vault scanner, incremental re-indexer (mtime comparison)

**Modified files:**
- `plugin/mcp-server/package.json` — Add `better-sqlite3` dependency
- `plugin/mcp-server/src/index.ts` — Initialize SQLite on startup, run incremental sync
- `plugin/mcp-server/src/tools/notes.ts` — `noteSearch()` queries FTS5
- `plugin/mcp-server/src/tools/tasks.ts` — `taskList()` queries SQLite
- `plugin/mcp-server/src/tools/memory.ts` — `memoryRead()` search uses indexed queries
- `plugin/mcp-server/src/tools/wikilink-tools.ts` — `wikilinkValidate()` uses wikilinks table
- `plugin/mcp-server/src/vault.ts` — Add `inbox/` and `memory/areas/` to `VAULT_DIRECTORIES`

#### Week 2: Composite Tools + Workflow Commands

**New files:**
- `plugin/mcp-server/src/tools/composite.ts` — 5 composite tools
- `plugin/mcp-server/src/tools/external.ts` — `sync_external`, `register_account`
- `plugin/commands/morning.md` — `/morning` command prompt
- `plugin/commands/review.md` — `/review` command (GTD Weekly Review)
- `plugin/skills/inbox-capture/SKILL.md` — Inbox capture behavior skill

**Modified files:**
- `plugin/mcp-server/src/index.ts` — Register all new tools
- `plugin/skills/task-management/SKILL.md` — Add inbox → task promotion workflow
- `plugin/skills/memory-management/SKILL.md` — Add areas concept, auto-promotion docs
- `plugin/commands/start.md` — Add inbox/ creation, areas/ creation, cron setup
- `plugin/commands/update.md` — Add sync_external call, reference_log update
- `CLAUDE.md` — Update architecture docs

**Phase 1 deliverables:**
- 10-100x faster search via SQLite FTS5
- 5 composite tools (morning_briefing, weekly_review, project_overview, quick_capture, search_and_summarize)
- 2 new commands (/morning, /review)
- Inbox folder + two-speed capture workflow
- PARA Areas support
- External data cache for calendar/email
- Automated daily briefing via cron

### Phase 2: Polish + Auto-Maintenance (Months 1-2)

| Task | Details |
|---|---|
| Auto-maintain CLAUDE.md hot cache | Regenerate from `reference_log` frequency. Top 30 people/terms/projects — computed, not manual. |
| Calendar/email cache maturation | Freshness indicators, per-account sync status, graceful API failure handling |
| Archive workflow | Completed projects → `memory/projects/archive/`. Optional auto-archive daily notes >90 days. |
| Glossary indexing | Parse glossary.md tables into SQLite on startup |
| Inbox processing UX | During `/review`, structured walkthrough per item with batch approval |
| File watcher (optional) | `chokidar` for re-indexing on external file changes |

### Phase 3: Semantic Intelligence (Months 3-6)

| Task | Details |
|---|---|
| sqlite-vec extension | Vector storage in existing `.vault-index.db` |
| Ollama integration | Embed with `nomic-embed-text` (768 dims, local, free) |
| Heading-level chunking | Split at `##` boundaries, embed each chunk with metadata |
| `semantic_search` tool | Hybrid FTS5 + vector cosine similarity, reciprocal rank fusion |
| Incremental embedding | Embed on file write/change, not at query time |
| Related notes suggestions | Surface semantically similar notes after creating a note |
| Proactive surfacing | "Project Phoenix has had no activity in 2 weeks" |

**Phase 3 trigger:** vault exceeds ~2,000 notes OR user reports search quality degradation.

---

## 8. User Requirements → Implementation Map

| Requirement | Phase | Implementation |
|---|---|---|
| **Task/project/reference interconnections** | Already strong + Phase 1 | Wikilinks + backlinks + Bases. Phase 1: Areas for 3-level hierarchy (Areas → Projects → Tasks). SQLite materializes link graph. |
| **Random thought capture + auto-cataloging** | Phase 1 | `inbox/` + `quick_capture` (two-speed: structured when Claude available, raw when not). Batch classification during `/review`. |
| **Subject search → summary + next steps** | Phase 1→3 | Phase 1: FTS5 search + Claude synthesis. Phase 3: semantic search for conceptual queries. |
| **Project holistic view** | Phase 1 | `project_overview` composite tool. `/project <name>` command. |
| **Multi-calendar/Gmail without SSO** | Phase 1 | SQLite external data cache. Cache from each account, query across all. Accept bounded staleness. |
| **Morning report** | Phase 1 | `morning_briefing` tool + `/morning` command + cron daily note. Calendar + tasks + next actions + email + waiting-fors + inbox count. |

---

## 9. Daily Note Template (Cron-Generated)

```markdown
---
title: Daily Note — 2026-03-29
tags: [daily]
date: 2026-03-29
generated: true
context: work
---

# Saturday, March 29, 2026

## Today's Focus
- **[[review-budget|Review budget proposal]]** — high priority, due today
- **[[draft-q2-roadmap|Draft Q2 roadmap]]** — for [[sarah-chen|Sarah]], due Monday

## Next Actions by Project
| Project | Next Action |
|---------|-------------|
| [[project-phoenix|Phoenix]] | Compare Q1 actuals (in [[review-budget|budget review]]) |
| [[project-horizon|Horizon]] | Waiting on [[todd-martinez|Todd]] for cost estimate (14 days) |

## Calendar
- 10:00 — Weekly sync (all-hands)
- 14:00 — 1:1 with [[sarah-chen|Sarah]]
- *Personal: 16:00 — Dentist*

## Open Loops
- ⚠️ [[review-budget|Review budget]] — overdue by 2 days
- ⏳ [[draft-q2-roadmap|Q2 roadmap]] — waiting on [[todd-martinez|Todd]], 14 days

## Email Highlights
- **Work (last synced 6h ago):** 2 from [[sarah-chen|Sarah]] re: Phoenix timeline
- **Personal (last synced 18h ago):** dentist confirmation

## Quick Notes

```

---

## 10. GTD Weekly Review (`/review` Command)

Seven-step structured walkthrough (assisted, not automated — Claude prepares materials, user decides):

1. **Process inbox** — clear `inbox/` folder, clarify each item into task/reference/trash
2. **Review active tasks** — each `status: active` task: still active? blocked? done? reschedule?
3. **Review waiting-fors** — `status: waiting` with days-waiting, prompt for follow-up
4. **Review projects** — each active project: has a next action? any activity this week? stuck (14+ days)?
5. **Review someday/maybe** — `status: someday` tasks: activate or delete?
6. **Review calendar** — 2 weeks forward (prep needed?), 1 week back (uncaptured commitments?)
7. **Review memory** — CLAUDE.md promotion/demotion proposals based on reference frequency

Produces a review summary note in `reviews/YYYY-MM-DD-review.md`.

---

## 11. Two-Speed Capture Model

**Speed 1 — AI-assisted (fast clarify):** User is talking to Claude. Claude decodes shorthand, creates full task/reference/memory note immediately. Inbox is skipped. This is the default when Claude is available.

**Speed 2 — Solo (deferred clarify):** User is on phone, in a meeting, or away from Claude. Raw text goes to `inbox/` as a minimal note (just a title, no frontmatter). Processing happens during `/update`, `/review`, or `/morning`. The inbox exists for when the AI isn't available — it's the fallback, not the default.

---

## 12. Existing Code — What Stays Unchanged

- `plugin/mcp-server/src/frontmatter.ts` — still used for parsing during indexing
- `plugin/mcp-server/src/wikilinks.ts` — still used for extraction during indexing
- `plugin/mcp-server/src/tools/bases-canvas.ts` — no changes
- `plugin/mcp-server/src/tools/obsidian-config.ts` — no changes
- All existing 23 atomic MCP tools — kept for backward compatibility; composite tools become the preferred interface

---

## Expert Consensus

All three experts unanimously agree on:
- Flat files as source of truth
- Obsidian as primary UI
- SQLite as read-optimized sidecar
- Claude as orchestration layer
- Memory shorthand decoder as the product moat
- Push-based daily briefing as the highest-impact improvement
- User-triggered inbox processing (never automatic)
- RAG deferred until vault scale demands it

---

## REVISION: Daily Radar Integration (2026-03-29)

The team reconvened after discovering an existing Cowork skill (`daily-radar`) that was ported to the Claude Code plugin. This revision updates the recommendation based on the daily-radar's capabilities.

### Key Change: Daily Radar Absorbs `/morning`

The daily-radar skill already does what the proposed `/morning` command would have done — and does it better with a polished visual HTML output. The `/morning` command is **removed** from the roadmap.

| Original Proposal | Revised |
|---|---|
| New `/morning` command | **Removed.** Daily-radar skill absorbs this role. |
| `morning_briefing` composite tool | **Renamed to `radar_data`** — returns structured JSON for the skill to render. |
| Pre-generated daily note only | **Both artifacts**: radar HTML (consumption) + daily note markdown (production). |
| Open Loops (priority tiers only) | **Enhanced** with per-project next actions as `→ Next:` sub-lines. |
| `/review` command | **Unchanged** — weekly review is a separate ritual. |

### Daily Radar Enhancements

The daily-radar skill gets four enhancements from the team's analysis:

#### 1. Per-Project Next Actions in Open Loops (Critical)

The GTD gap: the radar shows tasks but not the next concrete step. For each open loop item, surface the **first unchecked subtask** (`- [ ]` line) from the task note body:

```
🔥 OVERDUE
● Review budget proposal                         📓 tasks
  → Next: Pull Q1 actuals from finance portal
  Due: Mar 25 (4 days overdue)

🟠 ACTIVE — HIGH
● Draft Q2 roadmap                               📓 tasks
  → Next: Schedule kickoff with Sarah
  Due: Apr 3
```

Next actions are **woven into the existing priority tiers as sub-lines**, not a separate section. The morning radar stays urgency-first (the `/review` is project-first). An optional collapsible "By Project" view can appear below the priority-tier listing.

#### 2. Stale Waiting-For Escalation

- Show **days waiting** on each waiting-for item
- If there's a **calendar event with the person** in the lookahead window, badge it: "1:1 with Todd in 2 days — follow up?"
- Waiting-fors **older than 14 days** get promoted to the Watch column in the radar strip

#### 3. Inbox Count Badge

Small indicator in the header: "📥 3 items in inbox". Passive nudge, not intrusive. The GTD "collect" feedback loop — user always knows inbox status.

#### 4. Stuck Project Detection

If an active project has zero active tasks, add a Watch-tier radar card: "Project Phoenix has no defined next actions." GTD's stuck-project detection as a daily nudge.

### Dual Artifact Generation

The radar generates **two outputs** from the same data:

| Artifact | Format | Purpose | Location |
|---|---|---|---|
| Daily Radar | HTML | Visual briefing — scan, click source links, act | `radar-YYYY-MM-DD.html` |
| Daily Note | Markdown | Vault-native working doc — capture thoughts, wikilinks | `daily/YYYY-MM-DD.md` |

The HTML radar is the **consumption** artifact (read it, act, done). The daily note is the **production** artifact (write in it all day, participates in the vault's link graph, searchable via FTS5).

### `radar_data` Composite Tool (replaces `morning_briefing`)

The composite tool returns structured JSON organized for the radar's rendering needs:

```typescript
server.tool("radar_data", "Gather all data for daily radar briefing", {
  lookahead_days: z.number().optional(),
  include_email: z.boolean().optional(),
  include_calendar: z.boolean().optional(),
}, async ({ lookahead_days = 3, include_email = true, include_calendar = true }) => {
  return {
    date: today(),
    vault: {
      memory_context: claudemdRead(vault),
      tasks: {
        overdue: /* SQLite query: active tasks with due < today */,
        active: /* SQLite query: active tasks sorted by priority */,
        waiting: /* SQLite query: waiting tasks with days_waiting */,
      },
      next_actions: /* Per-project: first unchecked subtask per active project */,
      inbox_count: /* COUNT from inbox/ directory */,
      stuck_projects: /* Active projects with zero active tasks */,
    },
    calendar: /* From SQLite cache, all accounts, with freshness */,
    email: /* From SQLite cache, all accounts, with freshness */,
    sources_available: { vault: true, calendar: !!calendarData, email: !!emailData },
  };
});
```

The daily-radar skill uses `radar_data` when available (fast, indexed) and falls back to individual MCP tool calls when it's not (backward compatible with current architecture).

### Fire/Watch/FYI vs GTD Priorities

The productivity coach validated that Fire/Watch/FYI is **superior to traditional GTD priority levels** for daily engagement:

- **Fire = "Do it now"** — GTD's next action for today
- **Watch = "Plan for it"** — GTD's calendar/tickler items approaching
- **FYI = "Be aware"** — GTD's reference that surfaced

This mapping is more actionable than abstract high/medium/low because it's **time-bound**.

### Revised Phase 1 Deliverables

| Deliverable | Status |
|---|---|
| `radar_data` composite tool | NEW — serves daily-radar skill |
| Daily-radar skill enhancements (next actions, waiting-for escalation, inbox badge, stuck projects) | MODIFY existing skill |
| `/review` command | NEW — GTD weekly review, separate from radar |
| `weekly_review` composite tool | NEW — serves `/review` command |
| `project_overview` composite tool | NEW — unchanged |
| `quick_capture` tool + `inbox/` folder | NEW — unchanged |
| `sync_external` tool | NEW — unchanged |
| Cron: generate radar HTML + daily note | NEW |
| SQLite index (`index-db.ts`, `sync.ts`) | NEW — foundation for all composite tools |
| ~~`/morning` command~~ | ~~REMOVED~~ — absorbed by daily-radar |

### Files Changed (Revised)

**Modified:**
```
plugin/skills/daily-radar/SKILL.md       — Add per-project next actions to Open Loops,
                                           inbox count badge, stale waiting-for escalation,
                                           stuck project detection, daily note generation,
                                           radar_data preferred path with fallback
```

**New (unchanged from original):**
```
plugin/commands/review.md                — Weekly review command
plugin/commands/project.md               — Project status command
plugin/skills/quick-capture/SKILL.md     — Inbox capture skill
plugin/mcp-server/src/index-db.ts        — SQLite index
plugin/mcp-server/src/sync.ts            — Vault scanner
plugin/mcp-server/src/tools/composite.ts — radar_data, weekly_review, project_overview, quick_capture
plugin/mcp-server/src/tools/external.ts  — sync_external, register_account
```

**Removed:**
```
plugin/commands/morning.md               — No longer needed; daily-radar absorbs this role
```
