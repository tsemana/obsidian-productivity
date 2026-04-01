# SP2: Composite Tools, Skills & Commands, Cron — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 5 composite MCP tools, enhance the daily-radar skill, add the /review command and inbox-capture skill, wire up dual artifact generation, and configure cron automation — completing Phase 1 of the architecture roadmap.

**Architecture:** A single `composite.ts` file exports 5 functions that query SP1's SQLite index and return structured JSON. The existing `radar.ts` is modified to call `radarData()` and generate a daily note alongside the HTML. Three markdown files (command + 2 skills) teach Claude the new workflows. Cron is wired into `/start`.

**Tech Stack:** TypeScript (ES2022, Node16 modules), better-sqlite3 (existing), MCP SDK (existing). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-03-30-sp2-composite-tools-skills-cron-design.md](../specs/2026-03-30-sp2-composite-tools-skills-cron-design.md)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `plugin/mcp-server/src/tools/composite.ts` | 5 composite tool implementations + shared helpers |
| `plugin/commands/review.md` | `/review` command prompt (GTD Weekly Review) |
| `plugin/skills/inbox-capture/SKILL.md` | Inbox capture behavior skill |

### Modified Files

| File | Change Summary |
|------|---------------|
| `plugin/mcp-server/src/tools/radar.ts` | Export `TaskRow`, `EventRow`, `EmailRow` types; refactor `radarGenerate` to call `radarData`; add daily note generation |
| `plugin/mcp-server/src/index.ts` | Import composite tools, register 5 new `server.tool()` entries as Group 10 |
| `plugin/skills/daily-radar/SKILL.md` | Add `radar_data` preferred path, 4 enhancements |
| `plugin/commands/start.md` | Add cron job creation step |
| `plugin/.claude-plugin/plugin.json` | Version bump to 0.9.0 |

---

## Task 1: Export Types from `radar.ts`

The composite tools need access to `TaskRow`, `EventRow`, and `EmailRow` types currently defined as private interfaces in `radar.ts`.

**Files:**
- Modify: `plugin/mcp-server/src/tools/radar.ts:163-205`

- [ ] **Step 1: Export the three type interfaces**

In `plugin/mcp-server/src/tools/radar.ts`, change the three interface declarations from private to exported:

```typescript
// ─── Types ────────────────────────────────────────────────────────────────

export interface TaskRow {
  path: string;
  title: string | null;
  priority: string | null;
  due: string | null;
  body_preview: string | null;
  frontmatter_json: string | null;
}

export interface EventRow {
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

export interface EmailRow {
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
```

The only change is adding `export` before each `interface`.

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/tools/radar.ts
git commit -m "refactor: export TaskRow, EventRow, EmailRow types from radar.ts"
```

---

## Task 2: Create `composite.ts` with Shared Helpers and `radarData`

**Files:**
- Create: `plugin/mcp-server/src/tools/composite.ts`

- [ ] **Step 1: Create `composite.ts` with shared helpers and `radarData` implementation**

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TaskRow, EventRow, EmailRow } from "./radar.js";

// ─── Shared Helpers ──────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Extract the first unchecked checkbox from a body preview */
function extractNextAction(bodyPreview: string | null): string | null {
  if (!bodyPreview) return null;
  const match = bodyPreview.match(/^- \[ \] (.+)$/m);
  return match ? match[1] : null;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "for", "of",
  "in", "on", "at", "by", "with", "and", "or", "not", "this", "that",
  "it", "be", "has", "have", "had", "do", "does", "did", "but", "if",
  "from", "as", "will", "can", "would", "could", "should", "may",
]);

/** Extract top keywords from text for FTS5 search */
function extractKeywords(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .slice(0, 5)
    .join(" ");
}

// ─── Types ───────────────────────────────────────────────────────────────

export interface TaskWithNextAction {
  path: string;
  title: string | null;
  priority: string | null;
  due: string | null;
  project: string | null;
  next_action: string | null;
  frontmatter_json: string | null;
}

export interface WaitingTask extends TaskWithNextAction {
  days_waiting: number;
  waiting_on: string | null;
  upcoming_meeting: string | null;
}

export interface ProjectNextAction {
  project_path: string;
  project_title: string;
  task_path: string;
  task_title: string;
  next_action: string | null;
}

export interface StuckProject {
  path: string;
  title: string;
  active_task_count: number;
}

export interface RadarDataResult {
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
  calendar: EventRow[];
  email: EmailRow[];
  memory_context: string;
  sources_available: {
    vault: boolean;
    calendar: boolean;
    email: boolean;
  };
}

// ─── radar_data ──────────────────────────────────────────────────────────

/** radar_data — gather all data for the daily radar skill in a single call */
export async function radarData(
  db: DatabaseType,
  vaultPath: string,
  options: {
    lookahead_days?: number;
    include_email?: boolean;
    include_calendar?: boolean;
  } = {},
): Promise<RadarDataResult> {
  const date = todayStr();
  const lookaheadDays = options.lookahead_days ?? 3;
  const includeEmail = options.include_email ?? true;
  const includeCalendar = options.include_calendar ?? true;

  // Overdue tasks
  const overdueTasks = (db.prepare(`
    SELECT path, title, priority, due, project, body_preview, frontmatter_json
    FROM notes
    WHERE status = 'active' AND due IS NOT NULL AND due < ?
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY due ASC
  `).all(date) as Array<TaskRow & { project: string | null }>).map((t) => ({
    path: t.path,
    title: t.title,
    priority: t.priority,
    due: t.due,
    project: t.project,
    next_action: extractNextAction(t.body_preview),
    frontmatter_json: t.frontmatter_json,
  }));

  // Active tasks (not overdue)
  const activeTasks = (db.prepare(`
    SELECT path, title, priority, due, project, body_preview, frontmatter_json
    FROM notes
    WHERE status = 'active' AND (due IS NULL OR due >= ?)
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      due ASC NULLS LAST
  `).all(date) as Array<TaskRow & { project: string | null }>).map((t) => ({
    path: t.path,
    title: t.title,
    priority: t.priority,
    due: t.due,
    project: t.project,
    next_action: extractNextAction(t.body_preview),
    frontmatter_json: t.frontmatter_json,
  }));

  // Waiting tasks with days_waiting and calendar cross-ref
  const rawWaiting = db.prepare(`
    SELECT path, title, priority, due, project, body_preview, frontmatter_json, created
    FROM notes
    WHERE status = 'waiting'
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY due ASC NULLS LAST
  `).all() as Array<TaskRow & { project: string | null; created: string | null }>;

  const lookaheadEnd = new Date(new Date(date).getTime() + lookaheadDays * 86400000)
    .toISOString().slice(0, 10) + "T23:59:59";

  const waitingTasks: WaitingTask[] = rawWaiting.map((t) => {
    const fm = t.frontmatter_json ? JSON.parse(t.frontmatter_json) : {};
    const waitingSince = fm["waiting-since"] ?? t.created ?? date;
    const daysWaiting = Math.max(0,
      Math.ceil((new Date(date).getTime() - new Date(waitingSince).getTime()) / 86400000),
    );
    const waitingOn: string | null = fm["waiting-on"] ?? null;

    // Calendar cross-reference: check if there's a meeting with this person in lookahead
    let upcomingMeeting: string | null = null;
    if (waitingOn) {
      const personName = waitingOn.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/, "$2").trim() || waitingOn;
      const meeting = db.prepare(`
        SELECT ce.title, ce.start_time
        FROM calendar_events ce
        WHERE ce.start_time >= ? AND ce.start_time <= ?
        AND (ce.attendees LIKE ? OR ce.title LIKE ?)
        ORDER BY ce.start_time ASC LIMIT 1
      `).get(
        `${date}T00:00:00`, lookaheadEnd,
        `%${personName}%`, `%${personName}%`,
      ) as { title: string; start_time: string } | undefined;

      if (meeting) {
        const daysUntil = Math.ceil(
          (new Date(meeting.start_time).getTime() - new Date(date).getTime()) / 86400000,
        );
        upcomingMeeting = `${meeting.title} in ${daysUntil} day${daysUntil !== 1 ? "s" : ""} — follow up?`;
      }
    }

    return {
      path: t.path,
      title: t.title,
      priority: t.priority,
      due: t.due,
      project: t.project,
      next_action: extractNextAction(t.body_preview),
      frontmatter_json: t.frontmatter_json,
      days_waiting: daysWaiting,
      waiting_on: waitingOn,
      upcoming_meeting: upcomingMeeting,
    };
  });

  // Per-project next actions
  const activeProjects = db.prepare(`
    SELECT path, title FROM notes
    WHERE path LIKE 'memory/projects/%' AND path NOT LIKE 'memory/projects/archive/%'
    AND (frontmatter_json LIKE '%"status":"active"%' OR frontmatter_json LIKE '%"status":"in-progress"%')
  `).all() as Array<{ path: string; title: string }>;

  const nextActionsByProject: ProjectNextAction[] = [];
  for (const project of activeProjects) {
    const projectSlug = project.path.split("/").pop()?.replace(".md", "") ?? "";
    const nextTask = db.prepare(`
      SELECT path, title, body_preview FROM notes
      WHERE status = 'active' AND project LIKE ?
      AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
      ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        due ASC NULLS LAST
      LIMIT 1
    `).get(`%${projectSlug}%`) as { path: string; title: string | null; body_preview: string | null } | undefined;

    if (nextTask) {
      nextActionsByProject.push({
        project_path: project.path,
        project_title: project.title,
        task_path: nextTask.path,
        task_title: nextTask.title ?? nextTask.path,
        next_action: extractNextAction(nextTask.body_preview),
      });
    }
  }

  // Inbox count
  const inboxCount = (db.prepare(
    "SELECT COUNT(*) as cnt FROM notes WHERE path LIKE 'inbox/%'",
  ).get() as { cnt: number }).cnt;

  // Stuck projects: active projects with zero active tasks
  const stuckProjects: StuckProject[] = activeProjects
    .filter((p) => {
      const slug = p.path.split("/").pop()?.replace(".md", "") ?? "";
      const count = (db.prepare(`
        SELECT COUNT(*) as cnt FROM notes
        WHERE status = 'active' AND project LIKE ?
        AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
      `).get(`%${slug}%`) as { cnt: number }).cnt;
      return count === 0;
    })
    .map((p) => ({ path: p.path, title: p.title, active_task_count: 0 }));

  // Calendar events
  let calendarEvents: EventRow[] = [];
  if (includeCalendar) {
    calendarEvents = db.prepare(`
      SELECT ce.*, ea.account_email, ea.context
      FROM calendar_events ce
      JOIN external_accounts ea ON ce.account_id = ea.id
      WHERE ce.start_time >= ? AND ce.start_time <= ?
      ORDER BY ce.start_time
    `).all(`${date}T00:00:00`, lookaheadEnd) as EventRow[];
  }

  // Email highlights
  let emailHighlights: EmailRow[] = [];
  if (includeEmail) {
    emailHighlights = db.prepare(`
      SELECT ec.*, ea.account_email, ea.context
      FROM email_cache ec
      JOIN external_accounts ea ON ec.account_id = ea.id
      ORDER BY ec.date DESC LIMIT 20
    `).all() as EmailRow[];
  }

  // CLAUDE.md context
  let memoryContext = "";
  const claudemdPath = join(vaultPath, "CLAUDE.md");
  if (existsSync(claudemdPath)) {
    try { memoryContext = readFileSync(claudemdPath, "utf-8"); } catch { /* ignore */ }
  }

  return {
    date,
    vault: {
      tasks: { overdue: overdueTasks, active: activeTasks, waiting: waitingTasks },
      next_actions_by_project: nextActionsByProject,
      inbox_count: inboxCount,
      stuck_projects: stuckProjects,
    },
    calendar: calendarEvents,
    email: emailHighlights,
    memory_context: memoryContext,
    sources_available: {
      vault: true,
      calendar: calendarEvents.length > 0,
      email: emailHighlights.length > 0,
    },
  };
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/tools/composite.ts
git commit -m "feat: add radarData composite tool with shared helpers"
```

---

## Task 3: Add `weeklyReview` to `composite.ts`

**Files:**
- Modify: `plugin/mcp-server/src/tools/composite.ts`

- [ ] **Step 1: Add types and `weeklyReview` function**

Append the following after the `radarData` function in `composite.ts`:

```typescript
// ─── Types for weeklyReview ──────────────────────────────────────────────

export interface InboxItem {
  path: string;
  title: string | null;
  captured: string | null;
  hint: string | null;
  body_preview: string | null;
}

export interface ProjectSummary {
  path: string;
  title: string;
  active_task_count: number;
  waiting_task_count: number;
  has_next_action: boolean;
  last_activity: string | null;
}

export interface ReferenceFrequency {
  path: string;
  title: string;
  reference_count: number;
  last_referenced: string;
}

export interface WeeklyReviewResult {
  date: string;
  inbox: { items: InboxItem[]; count: number };
  active_tasks: { items: TaskWithNextAction[]; count: number };
  waiting_tasks: { items: WaitingTask[]; count: number };
  projects: { active: ProjectSummary[]; stuck: StuckProject[]; count: number };
  someday: { items: TaskWithNextAction[]; count: number };
  calendar_ahead: EventRow[];
  calendar_behind: EventRow[];
  memory: { claudemd: string; reference_frequency: ReferenceFrequency[] };
}

// ─── weekly_review ───────────────────────────────────────────────────────

/** weekly_review — all data for the GTD 7-step Weekly Review in one call */
export async function weeklyReview(
  db: DatabaseType,
  vaultPath: string,
): Promise<WeeklyReviewResult> {
  const date = todayStr();

  // Inbox items
  const inboxItems = (db.prepare(`
    SELECT path, title, frontmatter_json, body_preview FROM notes
    WHERE path LIKE 'inbox/%'
    ORDER BY modified_at DESC
  `).all() as Array<{ path: string; title: string | null; frontmatter_json: string | null; body_preview: string | null }>)
    .map((row) => {
      const fm = row.frontmatter_json ? JSON.parse(row.frontmatter_json) : {};
      return {
        path: row.path,
        title: row.title,
        captured: (fm.captured as string) ?? null,
        hint: (fm.hint as string) ?? null,
        body_preview: row.body_preview,
      };
    });

  // Active tasks
  const activeTaskRows = db.prepare(`
    SELECT path, title, priority, due, project, body_preview, frontmatter_json
    FROM notes
    WHERE status = 'active'
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      due ASC NULLS LAST
  `).all() as Array<TaskRow & { project: string | null }>;

  const activeTasks: TaskWithNextAction[] = activeTaskRows.map((t) => ({
    path: t.path,
    title: t.title,
    priority: t.priority,
    due: t.due,
    project: t.project,
    next_action: extractNextAction(t.body_preview),
    frontmatter_json: t.frontmatter_json,
  }));

  // Waiting tasks — reuse the same logic as radarData
  const rawWaiting = db.prepare(`
    SELECT path, title, priority, due, project, body_preview, frontmatter_json, created
    FROM notes
    WHERE status = 'waiting'
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY due ASC NULLS LAST
  `).all() as Array<TaskRow & { project: string | null; created: string | null }>;

  const twoWeeksOut = new Date(new Date(date).getTime() + 14 * 86400000)
    .toISOString().slice(0, 10) + "T23:59:59";

  const waitingTasks: WaitingTask[] = rawWaiting.map((t) => {
    const fm = t.frontmatter_json ? JSON.parse(t.frontmatter_json) : {};
    const waitingSince = fm["waiting-since"] ?? t.created ?? date;
    const daysWaiting = Math.max(0,
      Math.ceil((new Date(date).getTime() - new Date(waitingSince).getTime()) / 86400000),
    );
    const waitingOn: string | null = fm["waiting-on"] ?? null;

    // Calendar cross-ref for weekly review (2 week window)
    let upcomingMeeting: string | null = null;
    if (waitingOn) {
      const personName = waitingOn.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/, "$2").trim() || waitingOn;
      const meeting = db.prepare(`
        SELECT ce.title, ce.start_time
        FROM calendar_events ce
        WHERE ce.start_time >= ? AND ce.start_time <= ?
        AND (ce.attendees LIKE ? OR ce.title LIKE ?)
        ORDER BY ce.start_time ASC LIMIT 1
      `).get(
        `${date}T00:00:00`, twoWeeksOut,
        `%${personName}%`, `%${personName}%`,
      ) as { title: string; start_time: string } | undefined;

      if (meeting) {
        const daysUntil = Math.ceil(
          (new Date(meeting.start_time).getTime() - new Date(date).getTime()) / 86400000,
        );
        upcomingMeeting = `${meeting.title} in ${daysUntil} day${daysUntil !== 1 ? "s" : ""} — follow up?`;
      }
    }

    return {
      path: t.path, title: t.title, priority: t.priority, due: t.due,
      project: t.project, next_action: extractNextAction(t.body_preview),
      frontmatter_json: t.frontmatter_json, days_waiting: daysWaiting,
      waiting_on: waitingOn, upcoming_meeting: upcomingMeeting,
    };
  });

  // Projects with task counts
  const allProjects = db.prepare(`
    SELECT path, title FROM notes
    WHERE path LIKE 'memory/projects/%' AND path NOT LIKE 'memory/projects/archive/%'
    AND (frontmatter_json LIKE '%"status":"active"%' OR frontmatter_json LIKE '%"status":"in-progress"%')
  `).all() as Array<{ path: string; title: string }>;

  const projectSummaries: ProjectSummary[] = allProjects.map((p) => {
    const slug = p.path.split("/").pop()?.replace(".md", "") ?? "";
    const activeCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM notes
      WHERE status = 'active' AND project LIKE ?
      AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    `).get(`%${slug}%`) as { cnt: number }).cnt;

    const waitingCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM notes
      WHERE status = 'waiting' AND project LIKE ?
      AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    `).get(`%${slug}%`) as { cnt: number }).cnt;

    const lastActivity = (db.prepare(`
      SELECT MAX(modified_at) as last FROM notes
      WHERE project LIKE ? AND path LIKE 'tasks/%'
    `).get(`%${slug}%`) as { last: number | null }).last;

    return {
      path: p.path,
      title: p.title,
      active_task_count: activeCount,
      waiting_task_count: waitingCount,
      has_next_action: activeCount > 0,
      last_activity: lastActivity ? new Date(lastActivity).toISOString().slice(0, 10) : null,
    };
  });

  const stuckProjects = projectSummaries
    .filter((p) => p.active_task_count === 0 && p.waiting_task_count === 0)
    .map((p) => ({ path: p.path, title: p.title, active_task_count: 0 }));

  // Someday/maybe tasks
  const somedayRows = db.prepare(`
    SELECT path, title, priority, due, project, body_preview, frontmatter_json
    FROM notes
    WHERE status = 'someday'
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY modified_at DESC
  `).all() as Array<TaskRow & { project: string | null }>;

  const somedayTasks: TaskWithNextAction[] = somedayRows.map((t) => ({
    path: t.path, title: t.title, priority: t.priority, due: t.due,
    project: t.project, next_action: extractNextAction(t.body_preview),
    frontmatter_json: t.frontmatter_json,
  }));

  // Calendar: 2 weeks forward + 1 week back
  const oneWeekBack = new Date(new Date(date).getTime() - 7 * 86400000)
    .toISOString().slice(0, 10) + "T00:00:00";

  const calendarAhead = db.prepare(`
    SELECT ce.*, ea.account_email, ea.context
    FROM calendar_events ce
    JOIN external_accounts ea ON ce.account_id = ea.id
    WHERE ce.start_time >= ? AND ce.start_time <= ?
    ORDER BY ce.start_time
  `).all(`${date}T00:00:00`, twoWeeksOut) as EventRow[];

  const calendarBehind = db.prepare(`
    SELECT ce.*, ea.account_email, ea.context
    FROM calendar_events ce
    JOIN external_accounts ea ON ce.account_id = ea.id
    WHERE ce.start_time >= ? AND ce.start_time < ?
    ORDER BY ce.start_time
  `).all(oneWeekBack, `${date}T00:00:00`) as EventRow[];

  // Memory: CLAUDE.md + reference frequency
  let claudemd = "";
  const claudemdPath = join(vaultPath, "CLAUDE.md");
  if (existsSync(claudemdPath)) {
    try { claudemd = readFileSync(claudemdPath, "utf-8"); } catch { /* ignore */ }
  }

  const referenceFrequency = db.prepare(`
    SELECT rl.path, n.title,
      COUNT(*) as reference_count,
      MAX(rl.referenced_at) as last_referenced
    FROM reference_log rl
    LEFT JOIN notes n ON rl.path = n.path
    GROUP BY rl.path
    ORDER BY reference_count DESC
    LIMIT 30
  `).all() as Array<{ path: string; title: string | null; reference_count: number; last_referenced: number }>;

  return {
    date,
    inbox: { items: inboxItems, count: inboxItems.length },
    active_tasks: { items: activeTasks, count: activeTasks.length },
    waiting_tasks: { items: waitingTasks, count: waitingTasks.length },
    projects: {
      active: projectSummaries,
      stuck: stuckProjects,
      count: projectSummaries.length,
    },
    someday: { items: somedayTasks, count: somedayTasks.length },
    calendar_ahead: calendarAhead,
    calendar_behind: calendarBehind,
    memory: {
      claudemd,
      reference_frequency: referenceFrequency.map((r) => ({
        path: r.path,
        title: r.title ?? r.path,
        reference_count: r.reference_count,
        last_referenced: new Date(r.last_referenced).toISOString().slice(0, 10),
      })),
    },
  };
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/tools/composite.ts
git commit -m "feat: add weeklyReview composite tool"
```

---

## Task 4: Add `projectOverview` to `composite.ts`

**Files:**
- Modify: `plugin/mcp-server/src/tools/composite.ts`

- [ ] **Step 1: Add types and `projectOverview` function**

Append the following to `composite.ts`:

```typescript
// ─── Types for projectOverview ───────────────────────────────────────────

export interface PersonRef {
  path: string;
  title: string;
  role: string | null;
}

export interface FtsMatch {
  path: string;
  title: string | null;
  rank: number;
}

export interface WikilinkConnection {
  source_path: string;
  target_slug: string;
  display_text: string;
}

export interface ProjectOverviewResult {
  project: {
    path: string;
    frontmatter: Record<string, unknown> | null;
    body: string;
  };
  tasks: {
    active: TaskWithNextAction[];
    waiting: TaskWithNextAction[];
    completed_recent: TaskWithNextAction[];
    count: number;
  };
  people: PersonRef[];
  recent_mentions: FtsMatch[];
  connections: WikilinkConnection[];
}

// ─── project_overview ────────────────────────────────────────────────────

/** project_overview — holistic view of a single project */
export async function projectOverview(
  db: DatabaseType,
  vaultPath: string,
  options: { project: string },
): Promise<ProjectOverviewResult | { error: string; message: string }> {
  const { project } = options;

  // Find the project note — try exact path first, then FTS5 search
  let projectPath: string;
  let projectFrontmatter: Record<string, unknown> | null = null;
  let projectBody = "";

  if (project.endsWith(".md") && project.includes("/")) {
    // Exact path provided
    projectPath = project;
  } else {
    // Search by name in memory/projects/
    const match = db.prepare(`
      SELECT n.path, n.frontmatter_json FROM notes n
      JOIN notes_fts ON notes_fts.rowid = n.rowid
      WHERE notes_fts MATCH ? AND n.path LIKE 'memory/projects/%'
      ORDER BY bm25(notes_fts) LIMIT 1
    `).get(project) as { path: string; frontmatter_json: string | null } | undefined;

    if (!match) {
      return { error: "project_not_found", message: `No project matching "${project}" found in memory/projects/` };
    }
    projectPath = match.path;
  }

  // Read the project note
  const fullPath = join(vaultPath, projectPath);
  if (existsSync(fullPath)) {
    try {
      const content = readFileSync(fullPath, "utf-8");
      // Simple frontmatter extraction
      const fmRow = db.prepare("SELECT frontmatter_json FROM notes WHERE path = ?").get(projectPath) as { frontmatter_json: string | null } | undefined;
      projectFrontmatter = fmRow?.frontmatter_json ? JSON.parse(fmRow.frontmatter_json) : null;
      // Body = content after frontmatter
      const fmEnd = content.indexOf("---", content.indexOf("---") + 3);
      projectBody = fmEnd !== -1 ? content.slice(fmEnd + 3).trim() : content;
    } catch { /* ignore read errors */ }
  }

  const projectSlug = projectPath.split("/").pop()?.replace(".md", "") ?? "";

  // Tasks linked to this project
  const mapTask = (t: TaskRow & { project: string | null }): TaskWithNextAction => ({
    path: t.path, title: t.title, priority: t.priority, due: t.due,
    project: t.project, next_action: extractNextAction(t.body_preview),
    frontmatter_json: t.frontmatter_json,
  });

  const activeProjectTasks = (db.prepare(`
    SELECT path, title, priority, due, project, body_preview, frontmatter_json FROM notes
    WHERE status = 'active' AND project LIKE ?
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due ASC NULLS LAST
  `).all(`%${projectSlug}%`) as Array<TaskRow & { project: string | null }>).map(mapTask);

  const waitingProjectTasks = (db.prepare(`
    SELECT path, title, priority, due, project, body_preview, frontmatter_json FROM notes
    WHERE status = 'waiting' AND project LIKE ?
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY due ASC NULLS LAST
  `).all(`%${projectSlug}%`) as Array<TaskRow & { project: string | null }>).map(mapTask);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).getTime();
  const completedRecent = (db.prepare(`
    SELECT path, title, priority, due, project, body_preview, frontmatter_json FROM notes
    WHERE project LIKE ? AND path LIKE 'tasks/done/%' AND modified_at > ?
    ORDER BY modified_at DESC
  `).all(`%${projectSlug}%`, thirtyDaysAgo) as Array<TaskRow & { project: string | null }>).map(mapTask);

  // People connected to this project
  const peopleLinks = db.prepare(`
    SELECT DISTINCT w.target_slug FROM wikilinks w
    JOIN notes n ON w.source_path = n.path
    WHERE (n.project LIKE ? OR n.path = ?)
    AND w.target_slug IN (
      SELECT REPLACE(REPLACE(path, 'memory/people/', ''), '.md', '') FROM notes WHERE path LIKE 'memory/people/%'
    )
  `).all(`%${projectSlug}%`, projectPath) as Array<{ target_slug: string }>;

  const people: PersonRef[] = peopleLinks.map((link) => {
    const personNote = db.prepare(
      "SELECT path, title, frontmatter_json FROM notes WHERE path = ?",
    ).get(`memory/people/${link.target_slug}.md`) as { path: string; title: string | null; frontmatter_json: string | null } | undefined;

    if (!personNote) return null;
    const fm = personNote.frontmatter_json ? JSON.parse(personNote.frontmatter_json) : {};
    return {
      path: personNote.path,
      title: personNote.title ?? link.target_slug,
      role: (fm.role as string) ?? null,
    };
  }).filter((p): p is PersonRef => p !== null);

  // Recent FTS5 mentions
  const recentMentions = db.prepare(`
    SELECT n.path, n.title, bm25(notes_fts) as rank
    FROM notes_fts
    JOIN notes n ON notes_fts.rowid = n.rowid
    WHERE notes_fts MATCH ? AND n.path != ?
    ORDER BY rank LIMIT 10
  `).all(project, projectPath) as FtsMatch[];

  // Wikilink connections
  const outgoing = db.prepare(
    "SELECT source_path, target_slug, display_text FROM wikilinks WHERE source_path = ?",
  ).all(projectPath) as WikilinkConnection[];

  const incoming = db.prepare(
    "SELECT source_path, target_slug, display_text FROM wikilinks WHERE target_slug = ?",
  ).all(projectSlug) as WikilinkConnection[];

  const connections = [...outgoing, ...incoming];

  return {
    project: { path: projectPath, frontmatter: projectFrontmatter, body: projectBody },
    tasks: {
      active: activeProjectTasks,
      waiting: waitingProjectTasks,
      completed_recent: completedRecent,
      count: activeProjectTasks.length + waitingProjectTasks.length + completedRecent.length,
    },
    people,
    recent_mentions: recentMentions,
    connections,
  };
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/tools/composite.ts
git commit -m "feat: add projectOverview composite tool"
```

---

## Task 5: Add `quickCapture` to `composite.ts`

**Files:**
- Modify: `plugin/mcp-server/src/tools/composite.ts`

- [ ] **Step 1: Add imports for write operations**

At the top of `composite.ts`, add to the existing imports:

```typescript
import { noteWrite } from "./notes.js";
import { taskCreate } from "./tasks.js";
import { reindexFile } from "../sync.js";
```

- [ ] **Step 2: Add types and `quickCapture` function**

Append the following to `composite.ts`:

```typescript
// ─── Types for quickCapture ──────────────────────────────────────────────

export interface SuggestedLink {
  path: string;
  title: string | null;
}

export interface QuickCaptureResult {
  path: string;
  hint: string;
  suggested_links: SuggestedLink[];
  message: string;
}

// ─── quick_capture ───────────────────────────────────────────────────────

/** quick_capture — two-speed capture: structured task or raw inbox item */
export async function quickCapture(
  db: DatabaseType,
  vaultPath: string,
  options: {
    thought: string;
    hint?: "task" | "idea" | "reference" | "unknown";
  },
): Promise<QuickCaptureResult> {
  const { thought, hint = "unknown" } = options;

  // Suggest related notes via FTS5
  const keywords = extractKeywords(thought);
  let suggestedLinks: SuggestedLink[] = [];
  if (keywords.length > 0) {
    try {
      suggestedLinks = db.prepare(`
        SELECT n.path, n.title FROM notes_fts
        JOIN notes n ON notes_fts.rowid = n.rowid
        WHERE notes_fts MATCH ?
        LIMIT 5
      `).all(keywords) as SuggestedLink[];
    } catch { /* FTS5 query may fail on certain inputs — non-fatal */ }
  }

  if (hint === "task") {
    // Speed 1: create a full task note
    const result = taskCreate(vaultPath, {
      title: thought,
      status: "active",
      priority: "medium",
    }, db);

    if ("error" in result) {
      return { path: "", hint, suggested_links: suggestedLinks, message: result.message };
    }

    return {
      path: result.path,
      hint,
      suggested_links: suggestedLinks,
      message: `Task created: ${result.path}`,
    };
  }

  // Speed 2: create a raw inbox note
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = slugify(thought.slice(0, 50));
  const path = `inbox/${timestamp}-${slug}.md`;

  const frontmatter: Record<string, unknown> = {
    captured: new Date().toISOString(),
    hint,
    processed: false,
  };
  if (suggestedLinks.length > 0) {
    frontmatter.suggested_links = suggestedLinks.map((l) => l.path);
  }

  const writeResult = noteWrite(vaultPath, path, {
    frontmatter,
    body: `# ${thought}\n`,
  });

  if ("error" in writeResult) {
    return { path: "", hint, suggested_links: suggestedLinks, message: writeResult.message };
  }

  // Re-index the new file
  reindexFile(db, vaultPath, path);

  return {
    path,
    hint,
    suggested_links: suggestedLinks,
    message: `Captured to inbox: ${path}`,
  };
}
```

- [ ] **Step 3: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/src/tools/composite.ts
git commit -m "feat: add quickCapture composite tool"
```

---

## Task 6: Add `searchAndSummarize` to `composite.ts`

**Files:**
- Modify: `plugin/mcp-server/src/tools/composite.ts`

- [ ] **Step 1: Add types and `searchAndSummarize` function**

Append the following to `composite.ts`:

```typescript
// ─── Types for searchAndSummarize ────────────────────────────────────────

export interface SearchHit {
  path: string;
  title: string | null;
  rank: number;
  snippet: string;
  frontmatter: Record<string, unknown> | null;
}

export interface SearchResult {
  query: string;
  results: SearchHit[];
  count: number;
}

// ─── search_and_summarize ────────────────────────────────────────────────

/** search_and_summarize — FTS5 search with ranked results and context snippets */
export async function searchAndSummarize(
  db: DatabaseType,
  vaultPath: string,
  options: {
    query: string;
    directory?: string;
    limit?: number;
  },
): Promise<SearchResult> {
  const { query, directory, limit: rawLimit } = options;
  const limit = Math.min(Math.max(rawLimit ?? 10, 1), 50);

  const dirFilter = directory ? `AND n.path LIKE '${directory.replace(/'/g, "''")}/%'` : "";

  let results: SearchHit[];

  try {
    // Try using snippet() for context
    results = db.prepare(`
      SELECT n.path, n.title, bm25(notes_fts) as rank,
        snippet(notes_fts, 1, '...', '...', '...', 30) as snippet,
        n.frontmatter_json
      FROM notes_fts
      JOIN notes n ON notes_fts.rowid = n.rowid
      WHERE notes_fts MATCH ?
      ${dirFilter}
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as Array<{
      path: string; title: string | null; rank: number;
      snippet: string; frontmatter_json: string | null;
    }>;
  } catch {
    // Fallback: search without snippet (external content mode may not support it)
    results = db.prepare(`
      SELECT n.path, n.title, bm25(notes_fts) as rank,
        n.body_preview as snippet,
        n.frontmatter_json
      FROM notes_fts
      JOIN notes n ON notes_fts.rowid = n.rowid
      WHERE notes_fts MATCH ?
      ${dirFilter}
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as Array<{
      path: string; title: string | null; rank: number;
      snippet: string; frontmatter_json: string | null;
    }>;
  }

  // Log references for future CLAUDE.md auto-maintenance
  const now = Date.now();
  const insertRef = db.prepare(
    "INSERT INTO reference_log (path, referenced_at, context) VALUES (?, ?, 'search')",
  );
  const logTransaction = db.transaction(() => {
    for (const r of results) {
      insertRef.run(r.path, now);
    }
  });
  logTransaction();

  return {
    query,
    results: results.map((r) => ({
      path: r.path,
      title: r.title,
      rank: r.rank,
      snippet: r.snippet ?? "",
      frontmatter: r.frontmatter_json ? JSON.parse(r.frontmatter_json) : null,
    })),
    count: results.length,
  };
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/tools/composite.ts
git commit -m "feat: add searchAndSummarize composite tool"
```

---

## Task 7: Register All 5 Composite Tools in `index.ts`

**Files:**
- Modify: `plugin/mcp-server/src/index.ts`

- [ ] **Step 1: Add import for composite tools**

At the top of `index.ts`, after the existing imports (around line 19), add:

```typescript
import { radarData, weeklyReview, projectOverview, quickCapture, searchAndSummarize } from "./tools/composite.js";
```

- [ ] **Step 2: Add Group 10 tool registrations**

Insert the following before the `// ─── Start Server` section (before line 463):

```typescript
// ─── Group 10: Composite Workflow Tools ──────────────────────────────────

server.tool(
  "radar_data",
  "Gather all data for daily radar briefing in a single call. Returns tasks (overdue/active/waiting with next actions), per-project next actions, inbox count, stuck projects, calendar events, email highlights, and CLAUDE.md context.",
  {
    lookahead_days: z.number().optional().describe("Number of days to look ahead for calendar (default: 3)"),
    include_email: z.boolean().optional().describe("Include email highlights (default: true)"),
    include_calendar: z.boolean().optional().describe("Include calendar events (default: true)"),
  },
  async (params) => {
    if (!db) return { content: [{ type: "text", text: JSON.stringify({ error: "no_database", message: "SQLite not initialized" }) }] };
    const result = await radarData(db, requireVault(), params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "weekly_review",
  "Gather all data for the GTD Weekly Review in a single call. Returns inbox items, active tasks, waiting-fors with days waiting, project summaries, someday/maybe, calendar (2 weeks forward + 1 week back), and memory reference frequency.",
  {},
  async () => {
    if (!db) return { content: [{ type: "text", text: JSON.stringify({ error: "no_database", message: "SQLite not initialized" }) }] };
    const result = await weeklyReview(db, requireVault());
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "project_overview",
  "Get a holistic view of a single project: project note, linked tasks by status, connected people, recent FTS5 mentions, and wikilink graph neighbors.",
  {
    project: z.string().describe("Project name or path, e.g. 'phoenix' or 'memory/projects/project-phoenix.md'"),
  },
  async ({ project }) => {
    if (!db) return { content: [{ type: "text", text: JSON.stringify({ error: "no_database", message: "SQLite not initialized" }) }] };
    const result = await projectOverview(db, requireVault(), { project });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "quick_capture",
  "Capture a thought — creates a structured task (hint='task') or a raw inbox note (hint='idea'/'reference'/'unknown'). Returns suggested wikilinks from FTS5.",
  {
    thought: z.string().describe("The thought or task to capture"),
    hint: z.enum(["task", "idea", "reference", "unknown"]).optional().describe("Capture type hint (default: unknown)"),
  },
  async (params) => {
    if (!db) return { content: [{ type: "text", text: JSON.stringify({ error: "no_database", message: "SQLite not initialized" }) }] };
    const result = await quickCapture(db, requireVault(), params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "search_and_summarize",
  "Full-text search with BM25 ranking and context snippets. Supports boolean operators, phrase queries, and prefix matching. Logs results for reference frequency tracking.",
  {
    query: z.string().describe("FTS5 search query (supports AND, OR, NOT, 'phrase', prefix*)"),
    directory: z.string().optional().describe("Scope search to a directory, e.g. 'memory/projects'"),
    limit: z.number().optional().describe("Max results (default: 10, max: 50)"),
  },
  async (params) => {
    if (!db) return { content: [{ type: "text", text: JSON.stringify({ error: "no_database", message: "SQLite not initialized" }) }] };
    const result = await searchAndSummarize(db, requireVault(), params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);
```

- [ ] **Step 3: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/src/index.ts
git commit -m "feat: register 5 composite workflow tools in index.ts"
```

---

## Task 8: Refactor `radarGenerate` to Use `radarData` and Add Daily Note

**Files:**
- Modify: `plugin/mcp-server/src/tools/radar.ts`

- [ ] **Step 1: Add import for `radarData`**

At the top of `radar.ts`, add:

```typescript
import { radarData } from "./composite.js";
import type { RadarDataResult, TaskWithNextAction, WaitingTask } from "./composite.js";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
```

Remove the duplicate `readFileSync`, `writeFileSync`, `existsSync` from the existing imports if they're already imported (keep only one set).

- [ ] **Step 2: Rewrite `radarGenerate` to call `radarData` and generate daily note**

Replace the existing `radarGenerate` function body (lines 11-96) with:

```typescript
/** radar_generate — sync accounts, query all data via radarData, render radar HTML + daily note */
export async function radarGenerate(
  db: DatabaseType,
  vaultPath: string,
  options: {
    date?: string;
    sidecarPort?: number;
  } = {},
): Promise<{ path: string; daily_note_path: string; tasks_count: number; events_count: number; emails_count: number } | { error: string; message: string }> {
  const date = options.date ?? todayStr();

  // Step 1: Sync all accounts
  try {
    await accountSync(db);
  } catch {
    // Continue even if sync fails — render with whatever cached data exists
  }

  // Step 2: Get all data via radarData composite tool
  const data = await radarData(db, vaultPath);

  // Step 3: Convert radarData result back to the shapes renderRadarHtml expects
  const toTaskRow = (t: TaskWithNextAction): TaskRow => ({
    path: t.path, title: t.title, priority: t.priority,
    due: t.due, body_preview: null, frontmatter_json: t.frontmatter_json,
  });

  const overdueTasks = data.vault.tasks.overdue.map(toTaskRow);
  const activeTasks = data.vault.tasks.active.map(toTaskRow);
  const waitingTasks = data.vault.tasks.waiting.map(toTaskRow);

  // Step 4: Render HTML
  const html = renderRadarHtml({
    date,
    overdueTasks,
    activeTasks,
    waitingTasks,
    calendarEvents: data.calendar,
    emailHighlights: data.email,
    sidecarPort: options.sidecarPort,
  });

  // Step 5: Write radar HTML
  const filename = `radar-${date}.html`;
  const outputPath = join(vaultPath, filename);
  writeFileSync(outputPath, html, "utf-8");

  // Step 6: Generate daily note
  const dailyNotePath = `daily/${date}.md`;
  const dailyNoteFullPath = join(vaultPath, dailyNotePath);
  const dailyNoteContent = renderDailyNote(date, data);

  if (existsSync(dailyNoteFullPath)) {
    // Append or replace ## Generated Briefing section
    let existing = readFileSync(dailyNoteFullPath, "utf-8");
    const sectionMarker = "## Generated Briefing";
    const markerIndex = existing.indexOf(sectionMarker);
    if (markerIndex !== -1) {
      // Find the next ## heading or end of file
      const nextHeading = existing.indexOf("\n## ", markerIndex + sectionMarker.length);
      const endIndex = nextHeading !== -1 ? nextHeading : existing.length;
      existing = existing.slice(0, markerIndex) + sectionMarker + "\n\n" + dailyNoteContent + "\n" + existing.slice(endIndex);
    } else {
      existing = existing.trimEnd() + "\n\n" + sectionMarker + "\n\n" + dailyNoteContent + "\n";
    }
    writeFileSync(dailyNoteFullPath, existing, "utf-8");
  } else {
    // Create fresh daily note with full template
    const dateObj = new Date(date + "T12:00:00");
    const dateLabel = dateObj.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
    const frontmatter = `---\ntitle: "Daily Note — ${date}"\ntags: [daily]\ndate: ${date}\ngenerated: true\n---\n\n`;
    const fullNote = frontmatter + `# ${dateLabel}\n\n` + dailyNoteContent + "\n\n## Quick Notes\n\n";
    writeFileSync(dailyNoteFullPath, fullNote, "utf-8");
  }

  return {
    path: filename,
    daily_note_path: dailyNotePath,
    tasks_count: overdueTasks.length + activeTasks.length + waitingTasks.length,
    events_count: data.calendar.length,
    emails_count: data.email.length,
  };
}
```

- [ ] **Step 3: Add the `renderDailyNote` helper function**

Add this function before the `// ─── HTML Renderer` section:

```typescript
// ─── Daily Note Renderer ─────────────────────────────────────────────────

function renderDailyNote(date: string, data: RadarDataResult): string {
  const sections: string[] = [];

  // Today's Focus — overdue + high priority active
  const focusTasks = [
    ...data.vault.tasks.overdue,
    ...data.vault.tasks.active.filter((t) => t.priority === "high"),
  ].slice(0, 5);

  if (focusTasks.length > 0) {
    const lines = focusTasks.map((t) => {
      const slug = t.path.replace("tasks/", "").replace(".md", "");
      const display = t.title ?? slug;
      const badge = t.due && t.due < date ? "overdue" : `due ${t.due ?? "no date"}`;
      return `- **[[${slug}|${display}]]** — ${t.priority} priority, ${badge}`;
    });
    sections.push("## Today's Focus\n" + lines.join("\n"));
  }

  // Next Actions by Project
  if (data.vault.next_actions_by_project.length > 0) {
    const rows = data.vault.next_actions_by_project.map((na) => {
      const projSlug = na.project_path.replace("memory/projects/", "").replace(".md", "");
      const action = na.next_action ?? na.task_title;
      return `| [[${projSlug}|${na.project_title}]] | ${action} |`;
    });
    sections.push("## Next Actions by Project\n| Project | Next Action |\n|---------|-------------|\n" + rows.join("\n"));
  }

  // Calendar
  if (data.calendar.length > 0) {
    const lines = data.calendar
      .filter((e) => e.start_time.startsWith(date))
      .map((e) => {
        const time = e.all_day ? "All day" : new Date(e.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        return `- ${time} — ${e.title}`;
      });
    if (lines.length > 0) {
      sections.push("## Calendar\n" + lines.join("\n"));
    }
  }

  // Open Loops
  const loopLines: string[] = [];
  for (const t of data.vault.tasks.overdue) {
    const daysOverdue = Math.ceil((new Date(date).getTime() - new Date(t.due!).getTime()) / 86400000);
    loopLines.push(`- ${t.title ?? t.path} — ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue`);
  }
  for (const t of data.vault.tasks.active.filter((a) => a.priority === "high" && a.due)) {
    loopLines.push(`- ${t.title ?? t.path} — due ${t.due}`);
  }
  for (const t of data.vault.tasks.waiting) {
    const personText = t.waiting_on ? ` from ${t.waiting_on}` : "";
    loopLines.push(`- ${t.title ?? t.path}${personText} — waiting ${t.days_waiting} days`);
  }
  if (loopLines.length > 0) {
    sections.push("## Open Loops\n" + loopLines.join("\n"));
  }

  // Email Highlights
  if (data.email.length > 0) {
    const lines = data.email.slice(0, 8).map((e) => {
      return `- ${e.subject ?? "(No subject)"} — from ${e.sender ?? "unknown"}`;
    });
    sections.push("## Email Highlights\n" + lines.join("\n"));
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Verify the build compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 5: Commit**

```bash
git add plugin/mcp-server/src/tools/radar.ts
git commit -m "feat: refactor radarGenerate to use radarData, add daily note generation"
```

---

## Task 9: Enhance Daily-Radar Skill

**Files:**
- Modify: `plugin/skills/daily-radar/SKILL.md`

- [ ] **Step 1: Read the current skill file**

Read `plugin/skills/daily-radar/SKILL.md` in full to understand the current structure.

- [ ] **Step 2: Add `radar_data` preferred path and 4 enhancements**

In the skill's data collection section, add the `radar_data` preferred path as the first option:

After the `## 1. Data Collection` heading, insert before the existing subsections:

```markdown
### Preferred Path: radar_data Composite Tool

If the `radar_data` MCP tool is available (v0.8.0+ vaults with SQLite), call it once:

```
radar_data({ lookahead_days: 3 })
```

This returns all data in a single call: tasks (overdue/active/waiting with `next_action`), per-project next actions, inbox count, stuck projects, calendar events, email highlights, and CLAUDE.md context.

Use this data for all sections below. **Skip the individual data collection steps** (Google Calendar, Gmail, Obsidian vault) when `radar_data` is available.

If `radar_data` is not available, fall back to the individual MCP tool calls described below.
```

In the Open Loops section, add next action support:

```markdown
### Per-Project Next Actions

For each open loop item, if `next_action` is available from `radar_data`, add a sub-line:

```
🔥 OVERDUE
● Review budget proposal                         📓 tasks
  → Next: Pull Q1 actuals from finance portal
  Due: Mar 25 (4 days overdue)
```

Only show the `→ Next:` line when `next_action` is not null.
```

In the Waiting section, add escalation:

```markdown
### Stale Waiting-For Escalation

- Show days waiting for each waiting-for item (from `days_waiting` field)
- Items waiting **14+ days**: promote to the Watch column in the radar strip with "⚠ Waiting N days — escalate?"
- If `upcoming_meeting` is not null: show a calendar badge, e.g., "📅 1:1 with Todd in 2 days — follow up?"
```

In the radar header, add inbox badge:

```markdown
### Inbox Count Badge

If `inbox_count > 0` from `radar_data`, add a badge in the radar header:

```
📡 Daily Radar — Monday, March 30  📥 3 inbox items
```

Omit when inbox is empty.
```

Add stuck project detection:

```markdown
### Stuck Project Detection

If `stuck_projects` from `radar_data` is non-empty, add Watch-tier cards for each:

```
👀 WATCH
● Project Phoenix
  ⚠ No active tasks defined — needs next actions
```
```

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/daily-radar/SKILL.md
git commit -m "feat: enhance daily-radar skill with radar_data path, next actions, inbox badge, stuck projects"
```

---

## Task 10: Create `/review` Command

**Files:**
- Create: `plugin/commands/review.md`

- [ ] **Step 1: Create the review command file**

```markdown
---
description: GTD Weekly Review — structured 7-step walkthrough
---

# Review Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Conduct a structured GTD Weekly Review. This walks through 7 steps interactively, using `weekly_review` for data and existing atomic tools for mutations.

## Instructions

### 1. Gather Data

Call the `weekly_review` composite tool (single call, returns all data).

If `weekly_review` is not available, inform the user: "The /review command requires the SQLite index (v0.8.0+). Run /start to initialize."

### 2. Walk Through 7 Steps

Present each step's data, ask for batch decisions, and execute changes. Move through steps at a pace the user is comfortable with — don't rush. For each step, summarize the items, then ask for decisions.

**Step 1: Process Inbox**

List each item from `inbox.items`:
```
📥 Inbox (N items)

1. [idea] "Talk to Sarah about budget timeline" — captured Mar 28
2. [unknown] "Check if Horizon API docs are updated" — captured Mar 27
3. [reference] "Article on OKR frameworks" — captured Mar 26

For each: Task (T), Reference (R), or Trash (X)?
```

Execute decisions:
- **Task:** Call `task_create` with the thought as title. Ask for priority/project if not obvious.
- **Reference:** Call `note_move` to move from `inbox/` to `references/`.
- **Trash:** Delete the file with `note_write` (overwrite with empty) or inform user to delete.

**Step 2: Review Active Tasks**

List active tasks grouped by priority:
```
✅ Active Tasks (N items)

High Priority:
- Review budget proposal — due Mar 25 (overdue!)
- Draft Q2 roadmap — due Apr 3

Medium Priority:
- Update team wiki — no due date
- Research CI/CD options — due Apr 10

Still active? Done? Blocked? Reschedule?
```

Execute: `task_update` for status/due changes, `task_complete` for done items.

**Step 3: Review Waiting-Fors**

List waiting tasks with days waiting:
```
⏳ Waiting For (N items)

- Cost estimate from Todd — 14 days ⚠️
  📅 1:1 with Todd in 2 days — follow up?
- API docs from Priya — 3 days
- Feedback on proposal from Sarah — 7 days

Follow up? Convert to active? Drop?
```

Execute: `task_update` for status changes.

**Step 4: Review Projects**

List active projects with task counts. Flag stuck projects:
```
📂 Projects (N active)

● Phoenix — 3 active, 1 waiting, last activity: Mar 28
● Horizon — 0 active, 2 waiting ⚠️ STUCK — no next actions
● Q2 Planning — 5 active, 0 waiting, last activity: Mar 29

Define next actions for stuck projects? Mark any inactive?
```

Execute: `task_create` for new next actions, `note_write` for project status updates.

**Step 5: Review Someday/Maybe**

List someday tasks:
```
💭 Someday/Maybe (N items)

- Learn Rust basics
- Set up home automation
- Write blog post about GTD

Activate? Delete? Keep?
```

Execute: `task_update` (activate) or `task_complete` (delete).

**Step 6: Review Calendar**

Show upcoming 2 weeks:
```
📅 Calendar — Next 2 Weeks

Mon Mar 30: Weekly sync, 1:1 with Sarah
Tue Mar 31: Sprint planning
Wed Apr 1: All-hands, dentist (personal)
...

Any prep needed? Any commitments to capture?
```

Show past week:
```
📅 Last Week — Uncaptured Commitments?

Mon Mar 24: Budget review meeting
Tue Mar 25: Phoenix standup
...

Did any of these create tasks you haven't captured?
```

Execute: `task_create` or `quick_capture` as needed.

**Step 7: Review Memory**

Show reference frequency from `memory.reference_frequency`:
```
🧠 Memory — Top Referenced

1. sarah-chen (12 refs) — in CLAUDE.md ✓
2. project-phoenix (9 refs) — in CLAUDE.md ✓
3. todd-martinez (7 refs) — NOT in CLAUDE.md ← promote?
4. horizon-api (5 refs) — NOT in CLAUDE.md ← promote?
...

15. old-vendor (in CLAUDE.md, 0 refs) ← demote?

Promote or demote any items in CLAUDE.md?
```

Execute: `claudemd_update` for promotions/demotions.

### 3. Generate Review Summary

After all steps, create `reviews/YYYY-MM-DD-review.md`:

```markdown
---
title: Weekly Review — YYYY-MM-DD
tags: [review]
date: YYYY-MM-DD
---

# Weekly Review — YYYY-MM-DD

## Summary
- Inbox: N processed (N→task, N→reference, N→trash)
- Active tasks: N reviewed (N done, N rescheduled, N unchanged)
- Waiting: N reviewed (N followed up, N converted)
- Projects: N reviewed (N stuck projects addressed)
- Someday: N reviewed (N activated, N removed)
- Calendar: N items checked
- Memory: N promotions, N demotions

## Decisions Made
[List key decisions from each step]

## Next Week Focus
[Top 3-5 priorities based on the review]
```

Use `note_write` to create the file. Ensure the `reviews/` directory exists (create with `vault_init` if needed).

## Notes

- One `weekly_review` call provides all data — don't make additional data-fetching calls
- Move through steps at the user's pace — some users want to blitz through, others want to deliberate
- If a step has zero items, briefly note it and move on: "No inbox items — moving to active tasks."
- The review summary participates in the vault link graph — use wikilinks for people and projects
```

- [ ] **Step 2: Commit**

```bash
git add plugin/commands/review.md
git commit -m "feat: add /review command for GTD Weekly Review"
```

---

## Task 11: Create Inbox Capture Skill

**Files:**
- Create: `plugin/skills/inbox-capture/SKILL.md`

- [ ] **Step 1: Create the skill directory and file**

```bash
mkdir -p plugin/skills/inbox-capture
```

- [ ] **Step 2: Write the skill file**

```markdown
---
name: inbox-capture
description: >
  Two-speed thought capture: AI-assisted (instant task) or deferred (inbox note).
  Uses quick_capture MCP tool. Trigger when user says "capture this", "remind me",
  "inbox", "just note that", "save this thought", "I need to remember", "quick note",
  or shares a thought that needs to be persisted.
---

# Inbox Capture

Capture thoughts with minimal friction using the two-speed model.

## When to Use

Trigger this skill when the user shares a thought that needs to be persisted — whether it's a clear task or a vague idea. Also trigger during `/review` inbox processing.

**Trigger phrases:** "capture this", "remind me", "inbox this", "just note that", "save this thought", "I need to remember", "quick note", "add to my list", "don't let me forget".

## Two-Speed Capture Model

### Speed 1: AI-Assisted (Fast Clarify)

**When:** The user's intent is clear — you can interpret the shorthand, identify the project/person, and determine it's a task.

**Action:** Call `quick_capture` with `hint: "task"`. This creates a full task note in `tasks/` with proper frontmatter (title, status, priority, created). The inbox is skipped entirely.

**Example:**
```
User: "remind me to send the PSR to Todd by Friday"

→ quick_capture({ thought: "Send PSR to Todd", hint: "task" })
→ Creates tasks/send-psr-to-todd.md with due: Friday, project/person wikilinks
```

After capturing, if `suggested_links` are returned, mention them: "Created task. Related notes: [[todd-martinez]], [[project-phoenix]]."

### Speed 2: Deferred (Raw Capture)

**When:** The thought is ambiguous, the user explicitly says "just capture this" or "inbox this", or you're unsure whether it's a task, reference, or idea.

**Action:** Call `quick_capture` with `hint: "idea"`, `"reference"`, or `"unknown"`. This creates a timestamped note in `inbox/` for later processing during `/review`.

**Example:**
```
User: "something about the API rate limits being wrong"

→ quick_capture({ thought: "API rate limits might be wrong", hint: "idea" })
→ Creates inbox/2026-03-30T14-22-00-api-rate-limits-might-be-wrong.md
```

### Decision Guide

| Signal | Speed | Hint |
|--------|-------|------|
| User says "task", "todo", "need to", "should" | 1 | task |
| Clear action with a deadline or person | 1 | task |
| User says "inbox", "capture", "just note" | 2 | idea/unknown |
| Vague thought, no clear action | 2 | idea |
| URL, article, resource to save | 2 | reference |
| You're unsure | 2 | unknown |

## During /review Inbox Processing

When the `/review` command processes inbox items (Step 1), this skill guides the classification:

For each inbox item:
1. Read the full note content
2. Propose a classification:
   - **Task:** Suggest title, priority, project, person wikilinks
   - **Reference:** Suggest target directory (`references/` or a subdirectory)
   - **Trash:** Explain why it's no longer relevant
3. Wait for user approval before executing

Execute on approval:
- **Task:** `task_create` with the decoded details, then delete the inbox note
- **Reference:** `note_move` from `inbox/` to `references/`
- **Trash:** Delete the inbox note

## Notes

- `quick_capture` requires the SQLite index (v0.8.0+). If not available, fall back to `task_create` (for tasks) or `note_write` (for inbox items) directly.
- Always confirm the capture: "Captured: [title] → [location]"
- If `suggested_links` are returned, mention them to help the user build connections
- Don't over-classify — when in doubt, use Speed 2. The `/review` walkthrough handles deferred items properly.
```

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/inbox-capture/SKILL.md
git commit -m "feat: add inbox-capture skill for two-speed thought capture"
```

---

## Task 12: Update `/start` Command with Cron Setup

**Files:**
- Modify: `plugin/commands/start.md`

- [ ] **Step 1: Add cron setup section**

After the existing "### 8. Report Results" section (end of file, before "## Notes"), insert:

```markdown
### 9. Set Up Daily Radar Automation (Claude Code Only)

Check if the `CronCreate` tool is available (Claude Code only — Cowork and Desktop don't support cron).

**If CronCreate is available:**

1. Check if a cron named `daily-radar` already exists via `CronList`
2. If it doesn't exist, create it:
   ```
   CronCreate({
     name: "daily-radar",
     schedule: "0 7 * * 1-5",
     prompt: "Call radar_generate to create today's radar and daily note. Open the radar HTML file in the browser."
   })
   ```
3. Confirm: "Daily radar scheduled for 7:00 AM weekdays. Adjust with /schedule, or delete with CronDelete."

**If CronCreate is not available:**

Skip silently. Add a note to the report: "Tip: Use Claude Code for automated daily radar generation."
```

- [ ] **Step 2: Update the report results section**

In the existing "### 8. Report Results" section, add to the status report template:

```
- Automation: Daily radar cron [active/not available]
```

- [ ] **Step 3: Commit**

```bash
git add plugin/commands/start.md
git commit -m "feat: add cron setup for daily radar to /start command"
```

---

## Task 13: Version Bump and Final Verification

**Files:**
- Modify: `plugin/.claude-plugin/plugin.json`

- [ ] **Step 1: Bump version to 0.9.0**

In `plugin/.claude-plugin/plugin.json`, change `"version": "0.8.0"` to `"version": "0.9.0"`.

- [ ] **Step 2: Full build verification**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 3: Verify tool count**

Check that `index.ts` registers 36 tools by counting `server.tool(` occurrences:

```bash
grep -c "server.tool(" plugin/mcp-server/src/index.ts
```

Expected: `36`

- [ ] **Step 4: Verify file manifest**

Confirm all expected files exist:

```bash
ls plugin/mcp-server/src/tools/composite.ts
ls plugin/commands/review.md
ls plugin/skills/inbox-capture/SKILL.md
```

Expected: All three files exist.

- [ ] **Step 5: Commit**

```bash
git add plugin/.claude-plugin/plugin.json
git commit -m "chore: bump version to 0.9.0"
```
