import type { Database as DatabaseType } from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { TaskRow, EventRow, EmailRow } from "./types.js";
import { noteWrite } from "./notes.js";
import { taskCreate } from "./tasks.js";
import { reindexFile } from "../sync.js";

// ─── Shared Helpers ───────────────────────────────────────────────────────────

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

function extractNextAction(bodyPreview: string | null): string | null {
  if (!bodyPreview) return null;
  const match = bodyPreview.match(/^- \[ \] (.+)$/m);
  return match ? match[1].trim() : null;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "it", "its", "be", "was",
  "are", "were", "been", "has", "have", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "can", "this",
  "that", "these", "those", "i", "we", "you", "he", "she", "they",
  "me", "us", "him", "her", "them", "my", "our", "your", "his", "their",
  "not", "no", "so", "up", "if", "about", "into", "through", "than",
  "then", "when", "where", "what", "who", "how", "all", "each", "any",
  "both", "more", "also", "just", "other", "new", "get", "use",
]);

function extractKeywords(text: string): string {
  const words = text.split(/\s+/);
  const filtered = words
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Deduplicate and take top 5
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const w of filtered) {
    if (!seen.has(w)) {
      seen.add(w);
      unique.push(w);
      if (unique.length >= 5) break;
    }
  }
  return unique.join(" ");
}

// ─── Exported Types ───────────────────────────────────────────────────────────

export interface TaskWithNextAction extends TaskRow {
  next_action: string | null;
}

export interface WaitingTask extends TaskRow {
  days_waiting: number;
  waiting_on: string | null;
  upcoming_meeting: string | null;
}

export interface ProjectNextAction {
  project_path: string;
  project_title: string | null;
  task_path: string | null;
  task_title: string | null;
  next_action: string | null;
}

export interface StuckProject {
  path: string;
  title: string | null;
  active_task_count: number;
}

export interface RadarDataResult {
  date: string;
  vault: {
    tasks: { overdue: TaskWithNextAction[]; active: TaskWithNextAction[]; waiting: WaitingTask[] };
    next_actions_by_project: ProjectNextAction[];
    inbox_count: number;
    stuck_projects: StuckProject[];
  };
  calendar: EventRow[];
  email: EmailRow[];
  memory_context: string;
  sources_available: { vault: boolean; calendar: boolean; email: boolean };
}

export interface InboxItem {
  path: string;
  title: string | null;
  captured: string | null;
  hint: string | null;
  body_preview: string | null;
}

export interface ProjectSummary {
  project_path: string;
  project_title: string | null;
  active_task_count: number;
  waiting_task_count: number;
  has_next_action: boolean;
  last_activity: string | null;
}

export interface ReferenceFrequency {
  path: string;
  count: number;
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

export interface PersonRef {
  path: string;
  name: string | null;
  role: string | null;
}

export interface FtsMatch {
  path: string;
  title: string | null;
  snippet: string | null;
  rank: number;
}

export interface WikilinkConnection {
  source_path: string;
  target_slug: string;
  display_text: string | null;
}

export interface ProjectOverviewResult {
  project: { path: string; frontmatter: Record<string, unknown> | null; body: string };
  tasks: { active: TaskWithNextAction[]; waiting: WaitingTask[]; completed_recent: TaskRow[]; count: number };
  people: PersonRef[];
  recent_mentions: FtsMatch[];
  wikilink_connections: WikilinkConnection[];
}

export interface SuggestedLink {
  path: string;
  title: string | null;
  relevance_snippet: string | null;
}

export interface QuickCaptureResult {
  path: string;
  hint: string | null;
  suggested_links: SuggestedLink[];
  message: string;
}

export interface SearchHit {
  path: string;
  title: string | null;
  snippet: string | null;
  rank: number;
  frontmatter: Record<string, unknown> | null;
}

export interface SearchResult {
  query: string;
  directory: string | null;
  count: number;
  results: SearchHit[];
}

// ─── Helper: build WaitingTask with calendar cross-ref ───────────────────────

function buildWaitingTasks(
  db: DatabaseType,
  rawTasks: TaskRow[],
  lookaheadDays: number,
  today: string,
): WaitingTask[] {
  const lookaheadEnd =
    new Date(new Date(today).getTime() + lookaheadDays * 86400000)
      .toISOString()
      .slice(0, 10) + "T23:59:59";

  // Fetch upcoming calendar events once
  interface CalRow {
    id: string;
    title: string;
    start_time: string;
    attendees: string | null;
  }
  const upcomingEvents = db.prepare(`
    SELECT id, title, start_time, attendees
    FROM calendar_events
    WHERE start_time >= ? AND start_time <= ?
    ORDER BY start_time
  `).all(`${today}T00:00:00`, lookaheadEnd) as CalRow[];

  return rawTasks.map((task) => {
    const fm = task.frontmatter_json ? JSON.parse(task.frontmatter_json) as Record<string, unknown> : {};
    const waitingSince = (fm["waiting-since"] as string | undefined) ?? task.due ?? today;
    const daysWaiting = Math.ceil(
      (new Date(today).getTime() - new Date(waitingSince).getTime()) / 86400000,
    );
    const waitingOn = (fm["waiting-on"] as string | undefined) ?? null;

    // Attempt calendar cross-reference
    let upcomingMeeting: string | null = null;
    if (waitingOn) {
      const needle = waitingOn.toLowerCase();
      const match = upcomingEvents.find((e) => {
        if (e.title.toLowerCase().includes(needle)) return true;
        if (e.attendees) {
          try {
            const attendees = JSON.parse(e.attendees) as string[];
            return attendees.some((a) => a.toLowerCase().includes(needle));
          } catch {}
        }
        return false;
      });
      if (match) {
        const eventDate = new Date(match.start_time);
        const todayDate = new Date(today);
        const diffDays = Math.ceil((eventDate.getTime() - todayDate.getTime()) / 86400000);
        const relativeStr = diffDays === 0
          ? "today"
          : diffDays === 1
            ? "tomorrow"
            : `in ${diffDays} days`;
        upcomingMeeting = `${match.title} ${relativeStr} — follow up?`;
      }
    }

    return {
      ...task,
      days_waiting: Math.max(0, daysWaiting),
      waiting_on: waitingOn,
      upcoming_meeting: upcomingMeeting,
    };
  });
}

// ─── Tool 1: radarData ────────────────────────────────────────────────────────

export async function radarData(
  db: DatabaseType,
  vaultPath: string,
  options: {
    date?: string;
    lookahead_days?: number;
    include_email?: boolean;
    include_calendar?: boolean;
  } = {},
): Promise<RadarDataResult> {
  const date = options.date ?? todayStr();
  const includeEmail = options.include_email ?? true;
  const includeCalendar = options.include_calendar ?? true;

  // Default lookahead covers 3 business days (skips weekends)
  let lookaheadDays = options.lookahead_days ?? 3;
  if (options.lookahead_days === undefined) {
    const dayOfWeek = new Date(date + "T12:00:00").getDay(); // 0=Sun, 4=Thu, 5=Fri
    if (dayOfWeek === 4) lookaheadDays = 4;       // Thu: +4 covers Fri,Mon,Tue
    else if (dayOfWeek === 5) lookaheadDays = 5;   // Fri: +5 covers Mon,Tue,Wed
    else if (dayOfWeek === 6) lookaheadDays = 4;   // Sat: +4 covers Mon,Tue,Wed
    else if (dayOfWeek === 0) lookaheadDays = 3;   // Sun: +3 covers Mon,Tue,Wed
  }

  // Overdue tasks
  const overdueRaw = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE is_task = 1 AND status = 'active' AND due IS NOT NULL AND due < ?
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY due ASC
  `).all(date) as TaskRow[];

  const overdueTasks: TaskWithNextAction[] = overdueRaw.map((t) => ({
    ...t,
    next_action: extractNextAction(t.body_preview),
  }));

  // Active tasks
  const activeRaw = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE is_task = 1 AND status = 'active' AND (due IS NULL OR due >= ?)
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due ASC NULLS LAST
  `).all(date) as TaskRow[];

  const activeTasks: TaskWithNextAction[] = activeRaw.map((t) => ({
    ...t,
    next_action: extractNextAction(t.body_preview),
  }));

  // Waiting tasks
  const waitingRaw = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE is_task = 1 AND status = 'waiting'
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY due ASC NULLS LAST
  `).all() as TaskRow[];

  const waitingTasks = buildWaitingTasks(db, waitingRaw, lookaheadDays, date);

  // Active projects
  interface ProjectNoteRow {
    path: string;
    title: string | null;
    frontmatter_json: string | null;
  }
  const projectNotes = db.prepare(`
    SELECT path, title, frontmatter_json FROM notes
    WHERE path LIKE 'memory/projects/%' AND (status IS NULL OR status = 'active')
    ORDER BY title ASC
  `).all() as ProjectNoteRow[];

  // Batch: get top-priority task per project in a single query
  // Build slug list from project notes
  const projectSlugs = projectNotes.map((p) => p.path.replace(/^memory\/projects\//, "").replace(/\.md$/, ""));

  // Fetch all active tasks that belong to any known project, ranked by priority
  const allProjectTasks = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json, project, project_slug FROM notes
    WHERE is_task = 1 AND status = 'active'
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    AND project_slug IS NOT NULL
    ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due ASC NULLS LAST
  `).all() as (TaskRow & { project: string; project_slug: string | null })[];

  // Index: for each slug, find the first (highest priority) matching task
  const topTaskBySlug = new Map<string, TaskRow & { project: string; project_slug: string | null }>();
  for (const task of allProjectTasks) {
    for (const slug of projectSlugs) {
      if (!topTaskBySlug.has(slug) && task.project_slug === slug) {
        topTaskBySlug.set(slug, task);
      }
    }
  }

  const projectNextActions: ProjectNextAction[] = projectNotes.map((proj, i) => {
    const slug = projectSlugs[i];
    const topTask = topTaskBySlug.get(slug);
    return {
      project_path: proj.path,
      project_title: proj.title,
      task_path: topTask?.path ?? null,
      task_title: topTask?.title ?? null,
      next_action: topTask ? extractNextAction(topTask.body_preview) : null,
    };
  });

  // Inbox count
  const inboxRow = db.prepare(
    "SELECT COUNT(*) as cnt FROM notes WHERE path LIKE 'inbox/%'",
  ).get() as { cnt: number };
  const inboxCount = inboxRow.cnt;

  // Stuck projects: active projects with no matching active tasks
  // Reuses allProjectTasks from the batch query above — no additional DB queries
  const stuckProjects: StuckProject[] = projectNotes
    .filter((_, i) => !topTaskBySlug.has(projectSlugs[i]))
    .map((proj) => ({
      path: proj.path,
      title: proj.title,
      active_task_count: 0,
    }));

  // Calendar events
  const lookaheadEnd =
    new Date(new Date(date).getTime() + lookaheadDays * 86400000)
      .toISOString()
      .slice(0, 10) + "T23:59:59";

  let calendarEvents: EventRow[] = [];
  if (includeCalendar) {
    calendarEvents = db.prepare(`
      SELECT ce.id, ce.account_id, ce.calendar_id, ce.title,
        ce.start_time, ce.end_time, ce.all_day, ce.attendees,
        ce.location, ce.html_link, ce.rsvp_status,
        ea.account_email, ea.context
      FROM calendar_events ce
      JOIN external_accounts ea ON ce.account_id = ea.id
      WHERE ce.start_time >= ? AND ce.start_time <= ?
      ORDER BY ce.start_time
    `).all(`${date}T00:00:00`, lookaheadEnd) as EventRow[];
  }

  // Emails
  let emails: EmailRow[] = [];
  if (includeEmail) {
    emails = db.prepare(`
      SELECT ec.*, ea.account_email, ea.context
      FROM email_cache ec
      JOIN external_accounts ea ON ec.account_id = ea.id
      ORDER BY ec.date DESC LIMIT 20
    `).all() as EmailRow[];
  }

  // CLAUDE.md
  let memory_context = "";
  const claudemdPath = join(vaultPath, "CLAUDE.md");
  if (existsSync(claudemdPath)) {
    try { memory_context = readFileSync(claudemdPath, "utf-8"); } catch {}
  }

  // Determine sources availability (whether data exists in DB, regardless of include flags)
  const vaultAvailable = true;
  let calendarAvailable = calendarEvents.length > 0;
  let emailAvailable = emails.length > 0;
  if (!calendarAvailable && !includeCalendar) {
    try {
      calendarAvailable = (db.prepare("SELECT COUNT(*) as cnt FROM calendar_events").get() as { cnt: number }).cnt > 0;
    } catch {}
  }
  if (!emailAvailable && !includeEmail) {
    try {
      emailAvailable = (db.prepare("SELECT COUNT(*) as cnt FROM email_cache").get() as { cnt: number }).cnt > 0;
    } catch {}
  }

  return {
    date,
    vault: {
      tasks: { overdue: overdueTasks, active: activeTasks, waiting: waitingTasks },
      next_actions_by_project: projectNextActions,
      inbox_count: inboxCount,
      stuck_projects: stuckProjects,
    },
    calendar: calendarEvents,
    email: emails,
    memory_context,
    sources_available: { vault: vaultAvailable, calendar: calendarAvailable, email: emailAvailable },
  };
}

// ─── Tool 2: weeklyReview ────────────────────────────────────────────────────

export async function weeklyReview(
  db: DatabaseType,
  vaultPath: string,
): Promise<WeeklyReviewResult> {
  const date = todayStr();

  // Inbox items
  interface InboxRow {
    path: string;
    title: string | null;
    body_preview: string | null;
    frontmatter_json: string | null;
    modified_at: number | null;
  }
  const inboxRaw = db.prepare(`
    SELECT path, title, body_preview, frontmatter_json, modified_at FROM notes
    WHERE path LIKE 'inbox/%'
    ORDER BY modified_at DESC NULLS LAST
  `).all() as InboxRow[];
  const inboxItems: InboxItem[] = inboxRaw.map((row) => {
    let hint: string | null = null;
    let captured: string | null = null;
    if (row.frontmatter_json) {
      try {
        const fm = JSON.parse(row.frontmatter_json) as Record<string, unknown>;
        hint = typeof fm["hint"] === "string" ? fm["hint"] : null;
        captured = typeof fm["captured"] === "string" ? fm["captured"] : null;
      } catch {}
    }
    // Fall back to modified_at if captured not in frontmatter
    if (!captured && row.modified_at) {
      captured = new Date(row.modified_at).toISOString().slice(0, 10);
    }
    return { path: row.path, title: row.title, captured, hint, body_preview: row.body_preview };
  });

  // Active tasks (all)
  const activeRaw = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE is_task = 1 AND status = 'active'
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due ASC NULLS LAST
  `).all() as TaskRow[];

  const activeTasks: TaskWithNextAction[] = activeRaw.map((t) => ({
    ...t,
    next_action: extractNextAction(t.body_preview),
  }));

  // Waiting tasks with 2-week lookahead
  const waitingRaw = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE is_task = 1 AND status = 'waiting'
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY due ASC NULLS LAST
  `).all() as TaskRow[];

  const waitingTasks = buildWaitingTasks(db, waitingRaw, 14, date);

  // Projects with task counts, has_next_action, last_activity
  interface ProjectNoteRow {
    path: string;
    title: string | null;
    modified_at: number | null;
    frontmatter_json: string | null;
  }
  const projectNotes = db.prepare(`
    SELECT path, title, modified_at, frontmatter_json FROM notes
    WHERE path LIKE 'memory/projects/%' AND (status IS NULL OR status = 'active')
    ORDER BY title ASC
  `).all() as ProjectNoteRow[];

  const projects: ProjectSummary[] = [];
  const stuckProjects: StuckProject[] = [];

  for (const proj of projectNotes) {
    const slug = proj.path.replace(/^memory\/projects\//, "").replace(/\.md$/, "");

    const activeCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM notes
      WHERE is_task = 1 AND status = 'active'
      AND project_slug = ?
      AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    `).get(slug) as { cnt: number }).cnt;

    const waitingCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM notes
      WHERE is_task = 1 AND status = 'waiting'
      AND project_slug = ?
      AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    `).get(slug) as { cnt: number }).cnt;

    const topTask = db.prepare(`
      SELECT body_preview FROM notes
      WHERE is_task = 1 AND status = 'active'
      AND project_slug = ?
      AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
      ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END LIMIT 1
    `).get(slug) as { body_preview: string | null } | undefined;

    const hasNextAction = topTask ? extractNextAction(topTask.body_preview) !== null : false;

    const lastActivityMs = proj.modified_at;
    const lastActivity = lastActivityMs
      ? new Date(lastActivityMs).toISOString().slice(0, 10)
      : null;

    projects.push({
      project_path: proj.path,
      project_title: proj.title,
      active_task_count: activeCount,
      waiting_task_count: waitingCount,
      has_next_action: hasNextAction,
      last_activity: lastActivity,
    });

    if (activeCount === 0 && waitingCount === 0) {
      stuckProjects.push({ path: proj.path, title: proj.title, active_task_count: 0 });
    }
  }

  // Someday tasks
  const somedayRaw = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE tags LIKE '%"task"%' AND status = 'someday'
    AND path LIKE 'tasks/%'
    ORDER BY title ASC NULLS LAST
  `).all() as TaskRow[];
  const somedayTasks: TaskWithNextAction[] = somedayRaw.map((t) => ({
    ...t,
    next_action: extractNextAction(t.body_preview),
  }));

  // Calendar: split into ahead (2 weeks) and behind (1 week)
  const weekBack = new Date(new Date(date).getTime() - 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const twoWeeksAhead = new Date(new Date(date).getTime() + 14 * 86400000)
    .toISOString()
    .slice(0, 10) + "T23:59:59";

  const calendarAhead = db.prepare(`
    SELECT ce.*, ea.account_email, ea.context
    FROM calendar_events ce
    JOIN external_accounts ea ON ce.account_id = ea.id
    WHERE ce.start_time >= ? AND ce.start_time <= ?
    ORDER BY ce.start_time
  `).all(`${date}T00:00:00`, twoWeeksAhead) as EventRow[];

  const calendarBehind = db.prepare(`
    SELECT ce.*, ea.account_email, ea.context
    FROM calendar_events ce
    JOIN external_accounts ea ON ce.account_id = ea.id
    WHERE ce.start_time >= ? AND ce.start_time < ?
    ORDER BY ce.start_time DESC
  `).all(`${weekBack}T00:00:00`, `${date}T00:00:00`) as EventRow[];

  // Reference frequency: top 30 by count
  const referenceFrequency = db.prepare(`
    SELECT path, COUNT(*) as count
    FROM reference_log
    GROUP BY path
    ORDER BY count DESC
    LIMIT 30
  `).all() as ReferenceFrequency[];

  // CLAUDE.md
  let claudemd = "";
  const claudemdPath = join(vaultPath, "CLAUDE.md");
  if (existsSync(claudemdPath)) {
    try { claudemd = readFileSync(claudemdPath, "utf-8"); } catch {}
  }

  return {
    date,
    inbox: { items: inboxItems, count: inboxItems.length },
    active_tasks: { items: activeTasks, count: activeTasks.length },
    waiting_tasks: { items: waitingTasks, count: waitingTasks.length },
    projects: { active: projects, stuck: stuckProjects, count: projects.length },
    someday: { items: somedayTasks, count: somedayTasks.length },
    calendar_ahead: calendarAhead,
    calendar_behind: calendarBehind,
    memory: { claudemd, reference_frequency: referenceFrequency },
  };
}

// ─── Tool 3: projectOverview ─────────────────────────────────────────────────

export async function projectOverview(
  db: DatabaseType,
  vaultPath: string,
  options: { project: string },
): Promise<ProjectOverviewResult | { error: string; message: string }> {
  const { project } = options;
  const slug = slugify(project);

  // Find project note: try exact path first, then FTS5 search
  interface ProjectNoteRow {
    path: string;
    title: string | null;
    frontmatter_json: string | null;
  }
  let projectNote: ProjectNoteRow | undefined;

  const exactPath = `memory/projects/${slug}.md`;
  projectNote = db.prepare(
    "SELECT path, title, frontmatter_json FROM notes WHERE path = ?",
  ).get(exactPath) as ProjectNoteRow | undefined;

  if (!projectNote) {
    // FTS5 search scoped to memory/projects/
    const ftsQuery = slug.replace(/-/g, " ").split(" ")
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(" ");
    try {
      const ftsResults = db.prepare(`
        SELECT n.path, n.title, n.frontmatter_json
        FROM notes_fts fts
        JOIN notes n ON n.rowid = fts.rowid
        WHERE notes_fts MATCH ? AND n.path LIKE 'memory/projects/%'
        ORDER BY bm25(notes_fts)
        LIMIT 1
      `).get(ftsQuery) as ProjectNoteRow | undefined;
      if (ftsResults) projectNote = ftsResults;
    } catch {}
  }

  if (!projectNote) {
    // Fallback: LIKE search on path
    projectNote = db.prepare(
      "SELECT path, title, frontmatter_json FROM notes WHERE path LIKE 'memory/projects/%' AND path LIKE ? LIMIT 1",
    ).get(`%${slug}%`) as ProjectNoteRow | undefined;
  }

  if (!projectNote) {
    return { error: "project_not_found", message: `No project note found for "${project}"` };
  }

  const projectFrontmatter = projectNote.frontmatter_json
    ? JSON.parse(projectNote.frontmatter_json) as Record<string, unknown>
    : null;

  // Active tasks matching project slug
  const activeRaw = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE is_task = 1 AND status = 'active'
    AND project_slug = ?
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due ASC NULLS LAST
  `).all(slug) as TaskRow[];

  const activeTasks: TaskWithNextAction[] = activeRaw.map((t) => ({
    ...t,
    next_action: extractNextAction(t.body_preview),
  }));

  // Waiting tasks
  const waitingRaw = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE is_task = 1 AND status = 'waiting'
    AND project_slug = ?
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    ORDER BY due ASC NULLS LAST
  `).all(slug) as TaskRow[];

  const waitingTasks = buildWaitingTasks(db, waitingRaw, 14, todayStr());

  // Recently completed tasks (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const completedRecent = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
    WHERE is_task = 1 AND status = 'done'
    AND project_slug = ?
    AND (due >= ? OR created >= ?)
    ORDER BY due DESC NULLS LAST
    LIMIT 20
  `).all(slug, thirtyDaysAgo, thirtyDaysAgo) as TaskRow[];

  // People: wikilink targets from the project note that are in memory/people/
  interface WikilinkRow {
    target_slug: string;
    display_text: string;
  }
  const outgoingLinks = db.prepare(
    "SELECT target_slug, display_text FROM wikilinks WHERE source_path = ?",
  ).all(projectNote.path) as WikilinkRow[];

  const people: PersonRef[] = [];
  for (const link of outgoingLinks) {
    const personPath = `memory/people/${link.target_slug}.md`;
    const personNote = db.prepare(
      "SELECT path, title FROM notes WHERE path = ?",
    ).get(personPath) as { path: string; title: string | null } | undefined;
    if (personNote) {
      people.push({ path: personNote.path, name: personNote.title ?? link.display_text, role: null });
    }
  }

  // FTS5 mentions of the project, excluding the project note itself
  const mentionQuery = slug.replace(/-/g, " ").split(" ")
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
  let recentMentions: FtsMatch[] = [];
  try {
    interface FtsRow {
      path: string;
      title: string | null;
      snippet: string | null;
      rank: number;
    }
    const mentionRows = db.prepare(`
      SELECT n.path, n.title, snippet(notes_fts, 1, '[', ']', '...', 10) as snippet, bm25(notes_fts) as rank
      FROM notes_fts fts
      JOIN notes n ON n.rowid = fts.rowid
      WHERE notes_fts MATCH ? AND n.path != ?
      ORDER BY rank
      LIMIT 10
    `).all(mentionQuery, projectNote.path) as FtsRow[];
    recentMentions = mentionRows;
  } catch {}

  // Wikilink connections: outgoing + incoming
  const wikilinks: WikilinkConnection[] = [];

  // Outgoing: source is the project note, target is link.target_slug
  for (const link of outgoingLinks) {
    wikilinks.push({
      source_path: projectNote.path,
      target_slug: link.target_slug,
      display_text: link.display_text,
    });
  }

  // Incoming: source is whoever links to the project slug
  const projectSlug = projectNote.path.replace(/^.*\//, "").replace(/\.md$/, "");
  interface IncomingRow {
    source_path: string;
    display_text: string;
  }
  const incomingLinks = db.prepare(`
    SELECT wl.source_path, wl.display_text
    FROM wikilinks wl
    WHERE wl.target_slug = ?
  `).all(projectSlug) as IncomingRow[];

  for (const link of incomingLinks) {
    wikilinks.push({
      source_path: link.source_path,
      target_slug: projectSlug,
      display_text: link.display_text,
    });
  }

  // Read project note body
  let projectBody = "";
  const projectFilePath = join(vaultPath, projectNote.path);
  if (existsSync(projectFilePath)) {
    try { projectBody = readFileSync(projectFilePath, "utf-8"); } catch {}
  }

  return {
    project: { path: projectNote.path, frontmatter: projectFrontmatter, body: projectBody },
    tasks: {
      active: activeTasks,
      waiting: waitingTasks,
      completed_recent: completedRecent,
      count: activeTasks.length + waitingTasks.length,
    },
    people,
    recent_mentions: recentMentions,
    wikilink_connections: wikilinks,
  };
}

// ─── Tool 4: quickCapture ────────────────────────────────────────────────────

export async function quickCapture(
  db: DatabaseType,
  vaultPath: string,
  options: {
    thought: string;
    hint?: string;
  },
): Promise<QuickCaptureResult> {
  const { thought, hint } = options;
  let capturedPath: string;
  let message: string;

  if (hint === "task") {
    // Delegate to taskCreate
    const result = taskCreate(
      vaultPath,
      { title: thought, status: "active", priority: "medium" },
      db,
    );
    if ("error" in result) {
      // Fall back to inbox capture
      capturedPath = await captureToInbox(db, vaultPath, thought, hint ?? null);
      message = `Captured to inbox: ${capturedPath}`;
    } else {
      capturedPath = result.path;
      message = `Task created: ${capturedPath}`;
    }
  } else {
    capturedPath = await captureToInbox(db, vaultPath, thought, hint ?? null);
    message = `Captured to inbox: ${capturedPath}`;
  }

  // Suggested links via FTS5
  const keywords = extractKeywords(thought);
  const suggestedLinks: SuggestedLink[] = [];

  if (keywords) {
    const ftsQuery = keywords
      .split(" ")
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(" OR ");

    try {
      interface SuggestRow {
        path: string;
        title: string | null;
        snippet: string | null;
      }
      const rows = db.prepare(`
        SELECT n.path, n.title, snippet(notes_fts, 1, '[', ']', '...', 8) as snippet
        FROM notes_fts fts
        JOIN notes n ON n.rowid = fts.rowid
        WHERE notes_fts MATCH ? AND n.path != ?
        ORDER BY bm25(notes_fts)
        LIMIT 5
      `).all(ftsQuery, capturedPath) as SuggestRow[];

      for (const row of rows) {
        suggestedLinks.push({
          path: row.path,
          title: row.title,
          relevance_snippet: row.snippet,
        });
      }
    } catch {}
  }

  return { path: capturedPath, hint: hint ?? null, suggested_links: suggestedLinks, message };
}

async function captureToInbox(
  db: DatabaseType,
  vaultPath: string,
  thought: string,
  hint: string | null,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = slugify(thought).slice(0, 40) || "note";
  const inboxPath = `inbox/${timestamp}-${slug}.md`;

  const frontmatter: Record<string, unknown> = {
    captured: todayStr(),
    processed: false,
  };
  if (hint !== null) frontmatter["hint"] = hint;

  const result = noteWrite(vaultPath, inboxPath, {
    frontmatter,
    body: `# ${thought}\n`,
  });

  const finalPath = "error" in result ? inboxPath : result.path;

  try {
    reindexFile(db, vaultPath, finalPath);
  } catch {}

  return finalPath;
}

// ─── Tool 5: searchAndSummarize ──────────────────────────────────────────────

export async function searchAndSummarize(
  db: DatabaseType,
  vaultPath: string,
  options: {
    query: string;
    directory?: string;
    limit?: number;
  },
): Promise<SearchResult> {
  const { query, directory } = options;
  const limit = Math.min(options.limit ?? 10, 50);

  // Build FTS5 query
  const ftsQuery = query
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");

  interface SearchRow {
    path: string;
    title: string | null;
    snippet: string | null;
    rank: number;
    frontmatter_json: string | null;
  }

  let rows: SearchRow[] = [];

  // Try snippet() first — use separate prepared statements to avoid string interpolation
  try {
    if (directory) {
      rows = db.prepare(`
        SELECT n.path, n.title,
               snippet(notes_fts, 1, '[', ']', '...', 15) as snippet,
               bm25(notes_fts) as rank,
               n.frontmatter_json
        FROM notes_fts fts
        JOIN notes n ON n.rowid = fts.rowid
        WHERE notes_fts MATCH ? AND n.path LIKE ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, `${directory}/%`, limit) as SearchRow[];
    } else {
      rows = db.prepare(`
        SELECT n.path, n.title,
               snippet(notes_fts, 1, '[', ']', '...', 15) as snippet,
               bm25(notes_fts) as rank,
               n.frontmatter_json
        FROM notes_fts fts
        JOIN notes n ON n.rowid = fts.rowid
        WHERE notes_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit) as SearchRow[];
    }
  } catch {
    // Fallback: use body_preview
    try {
      if (directory) {
        rows = db.prepare(`
          SELECT n.path, n.title, n.body_preview as snippet, 0 as rank, n.frontmatter_json
          FROM notes_fts fts
          JOIN notes n ON n.rowid = fts.rowid
          WHERE notes_fts MATCH ? AND n.path LIKE ?
          LIMIT ?
        `).all(ftsQuery, `${directory}/%`, limit) as SearchRow[];
      } else {
        rows = db.prepare(`
          SELECT n.path, n.title, n.body_preview as snippet, 0 as rank, n.frontmatter_json
          FROM notes_fts fts
          JOIN notes n ON n.rowid = fts.rowid
          WHERE notes_fts MATCH ?
          LIMIT ?
        `).all(ftsQuery, limit) as SearchRow[];
      }
    } catch {}
  }

  // Log to reference_log
  const now = Date.now();
  const logStmt = db.prepare(
    "INSERT INTO reference_log (path, referenced_at, context) VALUES (?, ?, ?)",
  );
  const logTransaction = db.transaction(() => {
    for (const row of rows) {
      logStmt.run(row.path, now, "search");
    }
  });
  try { logTransaction(); } catch {}

  const hits: SearchHit[] = rows.map((row) => {
    let frontmatter: Record<string, unknown> | null = null;
    if (row.frontmatter_json) {
      try { frontmatter = JSON.parse(row.frontmatter_json) as Record<string, unknown>; } catch {}
    }
    return {
      path: row.path,
      title: row.title,
      snippet: row.snippet,
      rank: row.rank,
      frontmatter,
    };
  });

  return {
    query,
    directory: directory ?? null,
    count: hits.length,
    results: hits,
  };
}
