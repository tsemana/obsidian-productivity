# SP2: Composite Tools, Skills & Commands, Cron Automation

**Date:** 2026-03-30
**Status:** Design approved
**Parent:** [Architecture Recommendation](../../architecture-recommendation.md)
**Depends on:** [SP1: SQLite Foundation + Google Auth](2026-03-29-sp1-sqlite-foundation-google-auth-design.md)
**Scope:** Sub-project 2 of 2 (completes Phase 1 of the architecture roadmap)

---

## 1. Goal

Deliver the workflow layer that makes SP1's infrastructure user-facing:

- **5 composite MCP tools** that reduce 4-8 sequential tool calls to 1, returning structured JSON from SQLite.
- **Daily-radar skill enhancements** adding per-project next actions, stale waiting-for escalation, inbox count badge, and stuck project detection.
- **`/review` command** implementing the GTD Weekly Review as a 7-step interactive walkthrough.
- **Inbox-capture skill** teaching Claude the two-speed capture model.
- **Dual artifact generation** producing both radar HTML and daily note markdown from the same data.
- **Cron automation** for daily radar + daily note generation via Claude Code's `CronCreate`.

## 2. Boundaries

### In scope

- 5 composite tools in `tools/composite.ts`: `radar_data`, `weekly_review`, `project_overview`, `quick_capture`, `search_and_summarize`
- Register all 5 in `index.ts` (tool count: 31 existing + 5 = 36)
- Modify `radar_generate` to call `radar_data` internally and produce a daily note alongside the HTML
- Enhance `plugin/skills/daily-radar/SKILL.md` with 4 new behaviors
- Create `plugin/commands/review.md` for GTD Weekly Review
- Create `plugin/skills/inbox-capture/SKILL.md` for two-speed capture
- Update `plugin/commands/start.md` to create cron job
- Version bump to 0.9.0

### Out of scope (Phase 2 polish)

- Auto-maintain CLAUDE.md hot cache from reference frequency
- Calendar/email cache freshness indicators and graceful failure handling
- Archive workflow (completed projects, old daily notes)
- Glossary indexing into SQLite
- Inbox processing UX refinements beyond what `/review` provides
- File watcher (chokidar)

### Out of scope (Phase 3)

- RAG / semantic search (sqlite-vec + Ollama)

## 3. Composite Tools (`tools/composite.ts`)

All 5 tools follow the established pattern: exported async function, `db: DatabaseType` + `vaultPath: string` as first arguments, returns a typed object or `{ error: string; message: string }`. All queries go through SQLite (no file scans). The `db` parameter is required — these tools do not have a file-scan fallback since they exist specifically to leverage the index.

### 3.1 `radarData`

Gathers all data the daily-radar skill needs in a single call.

```typescript
radarData(db: DatabaseType, vaultPath: string, options?: {
  lookahead_days?: number;      // default 3
  include_email?: boolean;      // default true
  include_calendar?: boolean;   // default true
}): Promise<RadarDataResult>
```

**Return shape:**

```typescript
interface RadarDataResult {
  date: string;
  vault: {
    tasks: {
      overdue: TaskWithNextAction[];
      active: TaskWithNextAction[];
      waiting: WaitingTask[];
    };
    next_actions_by_project: ProjectNextAction[];
    inbox_count: number;
    stuck_projects: StuckProject[];
  };
  calendar: CalendarEvent[];
  email: EmailHighlight[];
  memory_context: string;
  sources_available: {
    vault: boolean;
    calendar: boolean;
    email: boolean;
  };
}

interface TaskWithNextAction {
  path: string;
  title: string | null;
  priority: string | null;
  due: string | null;
  project: string | null;
  next_action: string | null;   // first unchecked "- [ ]" from body_preview
  frontmatter_json: string | null;
}

interface WaitingTask extends TaskWithNextAction {
  days_waiting: number;         // computed from created or last status change
  waiting_on: string | null;    // from frontmatter
  upcoming_meeting: string | null; // calendar cross-ref: "1:1 with Todd in 2 days"
}

interface ProjectNextAction {
  project_path: string;
  project_title: string;
  task_path: string;
  task_title: string;
  next_action: string | null;
}

interface StuckProject {
  path: string;
  title: string;
  active_task_count: number;    // always 0 for stuck projects
}
```

**Implementation notes:**

- Next action extraction: parse `body_preview` for the first `- \[ \] (.+)` match. The 500-char preview covers the first checkbox in virtually all task notes.
- Stuck projects: query `notes` where `path LIKE 'memory/projects/%'` and frontmatter status is active, then LEFT JOIN against `notes` in `tasks/` with matching project wikilink. Projects with zero active tasks are stuck.
- Waiting-for calendar cross-reference: for each waiting task, extract the person from `waiting_on` frontmatter field, then check `calendar_events` for events with matching attendee name/email in the lookahead window.
- Inbox count: `SELECT COUNT(*) FROM notes WHERE path LIKE 'inbox/%'`.
- Email highlights: always returned regardless of cache freshness. No freshness gates — email processing happens through conversation interaction and is captured to memory automatically.

### 3.2 `weeklyReview`

Returns all data needed for the GTD 7-step Weekly Review in one call.

```typescript
weeklyReview(db: DatabaseType, vaultPath: string): Promise<WeeklyReviewResult>
```

**Return shape:**

```typescript
interface WeeklyReviewResult {
  date: string;
  inbox: {
    items: InboxItem[];
    count: number;
  };
  active_tasks: {
    items: TaskRow[];
    count: number;
  };
  waiting_tasks: {
    items: WaitingTask[];
    count: number;
  };
  projects: {
    active: ProjectSummary[];
    stuck: StuckProject[];
    count: number;
  };
  someday: {
    items: TaskRow[];
    count: number;
  };
  calendar_ahead: CalendarEvent[];   // 2 weeks forward
  calendar_behind: CalendarEvent[];  // 1 week back
  memory: {
    claudemd: string;
    reference_frequency: ReferenceFrequency[];
  };
}

interface InboxItem {
  path: string;
  title: string | null;
  captured: string | null;       // from frontmatter
  hint: string | null;           // "idea", "reference", "unknown"
  body_preview: string | null;
}

interface ProjectSummary {
  path: string;
  title: string;
  active_task_count: number;
  waiting_task_count: number;
  has_next_action: boolean;
  last_activity: string | null;  // most recent modified_at of linked tasks
}

interface ReferenceFrequency {
  path: string;
  title: string;
  reference_count: number;
  last_referenced: string;
}
```

**Implementation notes:**

- Inbox items: `SELECT * FROM notes WHERE path LIKE 'inbox/%' ORDER BY modified_at DESC`.
- Active tasks: all `status = 'active'` in `tasks/` (not `tasks/done/`).
- Waiting tasks: same `WaitingTask` type as `radarData` (reuse the query helper).
- Projects: query `memory/projects/%`, join against tasks for counts and activity.
- Someday: `status = 'someday'` in `tasks/`.
- Calendar ahead/behind: query `calendar_events` with `start_time` between `now - 7 days` and `now + 14 days`.
- Reference frequency: `SELECT path, COUNT(*) as reference_count FROM reference_log GROUP BY path ORDER BY reference_count DESC LIMIT 30`. Used by `/review` step 7 to propose CLAUDE.md promotion/demotion.

### 3.3 `projectOverview`

Aggregates a holistic view of a single project.

```typescript
projectOverview(db: DatabaseType, vaultPath: string, options: {
  project: string;
}): Promise<ProjectOverviewResult>
```

**Return shape:**

```typescript
interface ProjectOverviewResult {
  project: {
    path: string;
    frontmatter: Record<string, unknown> | null;
    body: string;
  };
  tasks: {
    active: TaskRow[];
    waiting: TaskRow[];
    completed_recent: TaskRow[];  // from tasks/done/, last 30 days
    count: number;
  };
  people: PersonRef[];
  recent_mentions: FtsMatch[];
  connections: WikilinkConnection[];
}

interface PersonRef {
  path: string;
  title: string;
  role: string | null;           // from frontmatter if available
}

interface FtsMatch {
  path: string;
  title: string | null;
  rank: number;
}

interface WikilinkConnection {
  source_path: string;
  target_slug: string;
  display_text: string;
}
```

**Implementation notes:**

- Project lookup: FTS5 search for the project name scoped to `memory/projects/%`. If exact path provided, direct read via `noteRead`.
- Tasks: query `notes` where `project` frontmatter field matches the project slug (LIKE match). Split by status.
- Completed recent: `tasks/done/%` with matching project, `modified_at > now - 30 days`.
- People: collect unique person wikilinks from the project note and its linked tasks. Cross-reference against `memory/people/%` notes.
- Recent mentions: FTS5 `MATCH` on the project title, excluding the project note itself. Limit 10.
- Connections: all wikilinks where `source_path` is the project note, plus reverse links (where `target_slug` matches the project).

### 3.4 `quickCapture`

Two-speed capture: structured task or raw inbox item.

```typescript
quickCapture(db: DatabaseType, vaultPath: string, options: {
  thought: string;
  hint?: "task" | "idea" | "reference" | "unknown";
}): Promise<QuickCaptureResult>
```

**Return shape:**

```typescript
interface QuickCaptureResult {
  path: string;
  hint: string;
  suggested_links: SuggestedLink[];
  message: string;
}

interface SuggestedLink {
  path: string;
  title: string | null;
}
```

**Implementation notes:**

- When `hint === "task"`: call `taskCreate(vaultPath, { title: thought, status: "active", priority: "medium" }, db)`. The existing `taskCreate` function handles slugification, frontmatter, and re-indexing.
- When `hint !== "task"`: create an inbox note at `inbox/{timestamp}-{slug}.md` with frontmatter `{ captured, hint, processed: false }` and body `# {thought}`. Call `noteWrite` then `reindexFile`.
- Suggested links: FTS5 search for keywords extracted from `thought` (split on spaces, filter stop words, take top 3 terms). `SELECT path, title FROM notes_fts WHERE notes_fts MATCH ? LIMIT 5`. Returned for all hints — the caller can use them to add wikilinks.
- Keyword extraction is simple: split on whitespace, lowercase, filter words < 3 chars and common stop words (the, a, an, is, are, was, were, to, for, of, in, on, at, by, with).

### 3.5 `searchAndSummarize`

FTS5 search with ranked results and context snippets.

```typescript
searchAndSummarize(db: DatabaseType, vaultPath: string, options: {
  query: string;
  directory?: string;
  limit?: number;
}): Promise<SearchResult>
```

**Return shape:**

```typescript
interface SearchResult {
  query: string;
  results: SearchHit[];
  count: number;
}

interface SearchHit {
  path: string;
  title: string | null;
  rank: number;
  snippet: string;              // ~200 chars around the best match
  frontmatter: Record<string, unknown> | null;
}
```

**Implementation notes:**

- Query: FTS5 `MATCH` with `bm25()` ranking. The query string is passed through to FTS5 — supports boolean operators (`AND`, `OR`, `NOT`), phrase queries (`"exact phrase"`), and prefix queries (`term*`).
- Snippet extraction: use FTS5 `snippet()` function with `...` as ellipsis markers and 30 tokens of context. Falls back to `body_preview` if snippet extraction fails.
- Directory scope: when `directory` is provided, add `WHERE path LIKE '{directory}/%'` to the query.
- Limit: default 10, max 50.
- Frontmatter: parsed from `frontmatter_json` column (stored as JSON string in SQLite).
- Reference logging: each search result is logged to `reference_log` with context `'search'` for future CLAUDE.md auto-maintenance (Phase 2).

### 3.6 Reused Types from SP1

`CalendarEvent` and `EmailHighlight` are the same row types already defined in `tools/radar.ts` (`EventRow` and `EmailRow`). SP2 imports and re-exports them from `composite.ts` rather than redefining. `TaskRow` similarly matches the existing type in `radar.ts`.

## 4. Shared Helpers

These private functions live at the top of `composite.ts` and are reused across multiple tools:

### 4.1 `extractNextAction(bodyPreview: string | null): string | null`

Parses `body_preview` for the first unchecked checkbox: regex `^- \[ \] (.+)$/m`. Returns the match group or null.

### 4.2 `extractKeywords(text: string): string`

Splits on whitespace, lowercases, filters words < 3 chars and common English stop words, returns the top 5 terms joined by spaces. Used by `quickCapture` for FTS5 suggested links.

### 4.3 `todayStr(): string`

Returns `new Date().toISOString().slice(0, 10)`. Already exists in `radar.ts` and `tasks.ts` — will duplicate here rather than extract to avoid modifying SP1 files.

### 4.4 `slugify(text: string): string`

Lowercase, strip non-alphanumeric, collapse spaces to hyphens. Already exists in `tasks.ts` — will duplicate here since `quickCapture` needs it for inbox filenames.

## 5. Modifications to `radar_generate`

The existing `radarGenerate` function in `tools/radar.ts` is modified to:

1. **Call `radarData` internally** instead of duplicating SQLite queries. The HTML rendering function receives a `RadarDataResult` object.
2. **Generate a daily note** after writing the HTML radar.
3. **Return the daily note path** in its response.

### 5.1 Daily Note Generation

After writing `radar-YYYY-MM-DD.html`, `radarGenerate` writes `daily/YYYY-MM-DD.md`:

```markdown
---
title: Daily Note — 2026-03-30
tags: [daily]
date: 2026-03-30
generated: true
context: work
---

# Monday, March 30, 2026

## Today's Focus
- **[[review-budget|Review budget proposal]]** — high priority, overdue
- **[[draft-q2-roadmap|Draft Q2 roadmap]]** — high priority, due Apr 3

## Next Actions by Project
| Project | Next Action |
|---------|-------------|
| [[project-phoenix|Phoenix]] | Pull Q1 actuals from finance portal |
| [[project-horizon|Horizon]] | Waiting on [[todd-martinez|Todd]] for cost estimate (14 days) |

## Calendar
- 10:00 — Weekly sync (all-hands)
- 14:00 — 1:1 with [[sarah-chen|Sarah]]

## Open Loops
- Review budget proposal — 4 days overdue
- Draft Q2 roadmap — due Apr 3
- Cost estimate from [[todd-martinez|Todd]] — waiting 14 days

## Email Highlights
- 2 from [[sarah-chen|Sarah]] re: Phoenix timeline
- Concur expense approval pending

## Quick Notes

```

### 5.2 Append vs Overwrite

**File does not exist:** Write the full template from Section 5.1 directly (no `## Generated Briefing` wrapper).

**File already exists** (user created it manually or from a template):

- Read the existing file
- Check for a `## Generated Briefing` section
- If present: replace that section's content using `replaceSection()` from `frontmatter.ts`
- If absent: append `\n## Generated Briefing\n` followed by the generated content (Today's Focus, Next Actions, Calendar, Open Loops, Email, Quick Notes sections)
- Never overwrite content outside the `## Generated Briefing` section — the user may have edited other sections

### 5.3 Updated Return Shape

```typescript
{
  path: string;              // radar HTML filename
  daily_note_path: string;   // daily note filename
  tasks_count: number;
  events_count: number;
  emails_count: number;
}
```

## 6. Daily-Radar Skill Enhancements

Modifications to `plugin/skills/daily-radar/SKILL.md`:

### 6.1 `radar_data` Preferred Path

Add instructions to use `radar_data` composite tool when available:

- If `radar_data` tool exists in the MCP tool list: call it once, use the structured response for all sections
- If not available (v0.7.0 vault, SQLite not initialized): fall back to individual tool calls (`task_list`, `memory_read`, `gcal_list_events`, `gmail_search_messages`) as currently implemented

### 6.2 Per-Project Next Actions

In the Open Loops section, for each task item, add a `→ Next:` sub-line showing `next_action` from the `radar_data` response. Only shown when `next_action` is not null.

### 6.3 Stale Waiting-For Escalation

In the Waiting section:
- Show `days_waiting` for each item
- Items with `days_waiting >= 14`: move to the Watch column in the radar strip with an escalation indicator
- If `upcoming_meeting` is not null: show a calendar cross-reference badge (e.g., "1:1 with Todd in 2 days — follow up?")

### 6.4 Inbox Count Badge

In the radar header, add `📥 N inbox items` when `inbox_count > 0`. Omit when inbox is empty.

### 6.5 Stuck Project Detection

Add stuck projects to the Watch column in the radar strip. Each stuck project gets a card: "Project Phoenix — no active tasks defined — needs next actions."

## 7. `/review` Command

New file: `plugin/commands/review.md`

The command prompt instructs Claude to:

1. Call `weekly_review` composite tool (single call)
2. Walk through 7 steps interactively, presenting data and asking for batch decisions:

**Step 1: Process Inbox** — List each item from `inbox.items`. For each, ask: "Task, reference, or trash?" Execute: `task_create` (for tasks), `note_move` to `references/` (for references), or delete (for trash).

**Step 2: Review Active Tasks** — List each from `active_tasks.items`. For each batch, ask: "Still active? Blocked? Done? Reschedule?" Execute: `task_update` (status/due changes), `task_complete` (done items).

**Step 3: Review Waiting-Fors** — List each from `waiting_tasks.items` with `days_waiting`. Prompt: "Follow up? Convert to active? Drop?" Execute: `task_update`.

**Step 4: Review Projects** — List `projects.active` with task counts. Flag `projects.stuck`. Ask: "Define next action? Mark inactive?" Execute: `task_create` (new next actions), `note_write` (status updates to project notes).

**Step 5: Review Someday/Maybe** — List `someday.items`. Ask: "Activate? Delete? Keep?" Execute: `task_update` or `task_complete`.

**Step 6: Review Calendar** — Show `calendar_ahead` (2 weeks). Ask: "Prep needed for any of these?" Show `calendar_behind` (1 week). Ask: "Any uncaptured commitments?" Execute: `task_create` or `quick_capture` as needed.

**Step 7: Review Memory** — Show `memory.reference_frequency` (top 30). Compare against current CLAUDE.md. Propose promotions (frequently referenced but not in CLAUDE.md) and demotions (in CLAUDE.md but rarely referenced). Execute: `claudemd_update`.

3. After all steps, generate `reviews/YYYY-MM-DD-review.md` summarizing: items processed, tasks created/completed/updated, projects reviewed, memory changes. Use `note_write`.

## 8. Inbox Capture Skill

New file: `plugin/skills/inbox-capture/SKILL.md`

Teaches Claude the two-speed capture model:

**Speed 1 — AI-assisted (fast clarify):** When the user shares a thought and Claude can interpret it, call `quick_capture` with `hint: "task"`. Claude decodes shorthand, fills in project/context/priority, creates a full task note. Inbox is skipped. This is the default when the user's intent is clear.

**Speed 2 — Deferred (raw capture):** When the thought is ambiguous, or the user says "just capture this" / "remind me later" / "inbox this", call `quick_capture` with `hint: "idea"`, `"reference"`, or `"unknown"`. Creates a minimal timestamped note in `inbox/`. Processing happens during `/review` step 1.

**Skill also covers behavior during `/review` inbox processing:** For each inbox item, Claude reads the full note, proposes a classification (task with suggested frontmatter, reference with suggested location, or trash with reason), and executes on user approval.

**Trigger phrases:** "capture this", "remind me", "inbox", "just note that", "save this thought", "I need to remember", "quick note".

## 9. Cron Automation

### 9.1 Cron Job Creation

The `/start` command (`plugin/commands/start.md`) is updated to include cron setup as a final step:

1. Check if a cron named `daily-radar` already exists (via `CronList`)
2. If not, create it:
   ```
   CronCreate({
     name: "daily-radar",
     schedule: "0 7 * * 1-5",
     prompt: "Call radar_generate to create today's radar and daily note. Then open the radar HTML file in the browser."
   })
   ```
3. Print confirmation: "Daily radar scheduled for 7:00 AM weekdays. Adjust with /schedule."

### 9.2 Platform Constraints

- **Claude Code only** — `CronCreate` is a Claude Code tool. Cowork and Claude Desktop don't have cron.
- **Missed runs** — if Claude Code isn't running at 7am, the cron executes on next launch.
- **Override** — user can change schedule via `/schedule` or delete via `CronDelete`.

### 9.3 `/start` Guard

The `/start` command checks for the cron tool's existence before attempting to create it. If `CronCreate` is not available (Cowork/Desktop), skip cron setup silently and note: "Cron automation requires Claude Code. Run `/update` manually to generate your daily radar."

## 10. File Manifest

### New Files

| File | Purpose |
|------|---------|
| `plugin/mcp-server/src/tools/composite.ts` | 5 composite tool implementations + shared helpers |
| `plugin/commands/review.md` | `/review` command prompt (GTD Weekly Review) |
| `plugin/skills/inbox-capture/SKILL.md` | Inbox capture behavior skill |

### Modified Files

| File | Change |
|------|--------|
| `plugin/mcp-server/src/tools/radar.ts` | Call `radarData` internally, generate daily note, return `daily_note_path` |
| `plugin/mcp-server/src/index.ts` | Import composite tools, register 5 new `server.tool()` entries |
| `plugin/skills/daily-radar/SKILL.md` | Add 4 enhancements (next actions, waiting-for escalation, inbox badge, stuck projects), `radar_data` preferred path |
| `plugin/commands/start.md` | Add cron job creation step |
| `plugin/.claude-plugin/plugin.json` | Version bump to 0.9.0 |

### No Changes

| File | Reason |
|------|--------|
| `plugin/mcp-server/src/index-db.ts` | No schema migration needed |
| `plugin/mcp-server/src/sync.ts` | No sync changes needed |
| `plugin/mcp-server/src/google-api.ts` | No API changes needed |
| `plugin/mcp-server/src/http-sidecar.ts` | No endpoint changes needed |
| `plugin/mcp-server/package.json` | No new dependencies |

## 11. Data Flow Summary

```
Skills / Commands / Cron
      │
      ├── daily-radar skill ──► radarData() ──► structured JSON
      ├── /review command ────► weeklyReview() ──► structured JSON
      ├── /review step 1 ────► quickCapture() ──► inbox/task note
      ├── any conversation ──► quickCapture() ──► inbox/task note
      └── search queries ────► searchAndSummarize() ──► ranked results
                                    │
                                    ▼
                              composite.ts
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              index-db.ts     google-api.ts    notes.ts / tasks.ts
              (SQLite)        (cache queries)  (file writes)
                    │               │               │
                    ▼               ▼               ▼
              .vault-index.db                vault .md files
                                              + reindexFile()

radar_generate (modified)
      │
      ├──► radarData() ──► data
      ├──► renderRadarHtml(data) ──► radar-YYYY-MM-DD.html
      └──► renderDailyNote(data) ──► daily/YYYY-MM-DD.md
```

## 12. Tool Registration in `index.ts`

New group added after Group 9 (Radar):

```
// ─── Group 10: Composite Workflow Tools ──────────────────────────────────

server.tool("radar_data", ...)
server.tool("weekly_review", ...)
server.tool("project_overview", ...)
server.tool("quick_capture", ...)
server.tool("search_and_summarize", ...)
```

All 5 require `db` — if SQLite is not initialized, return `{ error: "no_database", message: "SQLite not initialized" }`.

Total tool count: 31 (SP1) + 5 = 36.

## 13. Version

Bump `plugin/.claude-plugin/plugin.json` version to `0.9.0`.
