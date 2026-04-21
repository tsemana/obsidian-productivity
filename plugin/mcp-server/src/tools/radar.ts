import type { Database as DatabaseType } from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { accountSync } from "./external.js";
import { radarData } from "./composite.js";
import type { RadarDataResult, TaskWithNextAction, WaitingTask } from "./composite.js";
import { replaceSection } from "../frontmatter.js";
export type { TaskRow, EventRow, EmailRow } from "./types.js";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Render a daily note markdown file from RadarDataResult */
function renderDailyNote(date: string, data: RadarDataResult): string {
  const { vault, calendar, email } = data;
  const { overdue, active, waiting } = vault.tasks;

  // ## Today's Focus — overdue + high priority, with wikilinks
  const focusItems = [
    ...overdue.map((t) => `- [ ] [[${t.path}|${t.title ?? t.path}]] *(overdue: ${t.due})*${t.next_action ? ` — ${t.next_action}` : ""}`),
    ...active.filter((t) => t.priority === "high").map((t) => `- [ ] [[${t.path}|${t.title ?? t.path}]]${t.due ? ` *(due: ${t.due})*` : ""}${t.next_action ? ` — ${t.next_action}` : ""}`),
  ];

  // ## Next Actions by Project — table
  const naRows = vault.next_actions_by_project.map((p) => {
    const proj = p.project_title ?? p.project_path;
    const task = p.task_title ?? p.task_path ?? "—";
    const action = p.next_action ?? "—";
    return `| [[${p.project_path}\\|${proj}]] | ${task} | ${action} |`;
  });

  // ## Calendar — today's events
  const todayEvents = calendar.filter((e) => e.start_time.startsWith(date));
  const calLines = todayEvents.map((e) => {
    const time = e.all_day
      ? "All day"
      : new Date(e.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `- ${time} — ${e.title}${e.location ? ` @ ${e.location}` : ""}`;
  });

  // ## Open Loops — overdue + high priority + waiting
  const loopItems = [
    ...overdue.map((t) => `- [ ] [[${t.path}|${t.title ?? t.path}]] *(overdue)*`),
    ...active.filter((t) => t.priority === "high").map((t) => `- [ ] [[${t.path}|${t.title ?? t.path}]] *(high)*`),
    ...waiting.map((t) => `- [ ] [[${t.path}|${t.title ?? t.path}]] *(waiting ${t.days_waiting}d${t.waiting_on ? ` on ${t.waiting_on}` : ""})*`),
  ];

  // ## Email Highlights — top emails
  const emailLines = email.slice(0, 10).map((e) => {
    const flag = e.is_starred ? "⭐ " : e.is_important ? "❗ " : "";
    return `- ${flag}**${e.subject ?? "(No subject)"}** — ${e.sender ?? "unknown"}`;
  });

  const lines: string[] = [
    `---`,
    `date: ${date}`,
    `tags: [daily]`,
    `---`,
    ``,
    `## Today's Focus`,
    focusItems.length > 0 ? focusItems.join("\n") : "_Nothing urgent_",
    ``,
    `## Next Actions by Project`,
  ];

  if (naRows.length > 0) {
    lines.push(`| Project | Task | Next Action |`);
    lines.push(`| --- | --- | --- |`);
    lines.push(...naRows);
  } else {
    lines.push(`_No active projects_`);
  }

  lines.push(
    ``,
    `## Calendar`,
    calLines.length > 0 ? calLines.join("\n") : "_No events today_",
    ``,
    `## Open Loops`,
    loopItems.length > 0 ? loopItems.join("\n") : "_All clear_",
    ``,
    `## Email Highlights`,
    emailLines.length > 0 ? emailLines.join("\n") : "_No emails_",
  );

  return lines.join("\n");
}

/** Write or update daily note in daily/YYYY-MM-DD.md */
function writeDailyNote(vaultPath: string, date: string, data: RadarDataResult): string {
  const dailyDir = join(vaultPath, "daily");
  const notePath = join(dailyDir, `${date}.md`);
  const relativePath = `daily/${date}.md`;

  // Ensure daily/ directory exists
  if (!existsSync(dailyDir)) {
    mkdirSync(dailyDir, { recursive: true });
  }

  const generatedContent = renderDailyNote(date, data);
  const sectionHeading = "## Generated Briefing";

  if (existsSync(notePath)) {
    const existing = readFileSync(notePath, "utf-8");
    const sectionBody = `\n${generatedContent}\n`;
    const updated = replaceSection(existing, sectionHeading, sectionBody);
    writeFileSync(notePath, updated, "utf-8");
  } else {
    writeFileSync(notePath, generatedContent, "utf-8");
  }

  return relativePath;
}

/** radar_generate — sync accounts, query all data, render radar HTML and daily note */
export async function radarGenerate(
  db: DatabaseType,
  vaultPath: string,
  options: {
    date?: string;
    sidecarPort?: number;
    sidecarToken?: string;
    syncAccounts?: boolean;
  } = {},
): Promise<{ path: string; daily_note_path: string; tasks_count: number; events_count: number; emails_count: number } | { error: string; message: string }> {
  const date = options.date ?? todayStr();

  // Step 1: Sync all accounts
  if (options.syncAccounts !== false) {
    try {
      await accountSync(db);
    } catch {
      // Continue even if sync fails — render with whatever cached data exists
    }
  }

  // Step 2: Gather all data via radarData composite tool
  const data = await radarData(db, vaultPath, { date });

  // Step 3: Convert TaskWithNextAction/WaitingTask → TaskRow for renderRadarHtml
  const overdueTasks: TaskRow[] = data.vault.tasks.overdue.map((t) => ({
    path: t.path,
    title: t.title,
    priority: t.priority,
    due: t.due,
    body_preview: t.body_preview,
    frontmatter_json: t.frontmatter_json,
  }));

  const activeTasks: TaskRow[] = data.vault.tasks.active.map((t) => ({
    path: t.path,
    title: t.title,
    priority: t.priority,
    due: t.due,
    body_preview: t.body_preview,
    frontmatter_json: t.frontmatter_json,
  }));

  const waitingTasks: TaskRow[] = data.vault.tasks.waiting.map((t) => ({
    path: t.path,
    title: t.title,
    priority: t.priority,
    due: t.due,
    body_preview: t.body_preview,
    frontmatter_json: t.frontmatter_json,
  }));

  // Step 4: Render HTML
  const html = renderRadarHtml({
    date,
    overdueTasks,
    activeTasks,
    waitingTasks,
    calendarEvents: data.calendar,
    emailHighlights: data.email,
    sidecarPort: options.sidecarPort,
    sidecarToken: options.sidecarToken,
  });

  // Step 5: Write HTML file
  const filename = `radar-${date}.html`;
  const outputPath = join(vaultPath, filename);
  writeFileSync(outputPath, html, "utf-8");

  // Step 6: Write daily note
  const daily_note_path = writeDailyNote(vaultPath, date, data);

  return {
    path: filename,
    daily_note_path,
    tasks_count: overdueTasks.length + activeTasks.length + waitingTasks.length,
    events_count: data.calendar.length,
    emails_count: data.email.length,
  };
}

/** radar_update_item — modify a single item's visual state in the radar HTML */
export function radarUpdateItem(
  vaultPath: string,
  options: {
    path?: string;
    email_id?: string;
    state: "resolved" | "active";
    date?: string;
    explanation?: string;
  },
): { path?: string; email_id?: string; state: string; updated: boolean } | { error: string; message: string } {
  const date = options.date ?? todayStr();
  const radarFile = join(vaultPath, `radar-${date}.html`);

  if (!existsSync(radarFile)) {
    return { error: "file_not_found", message: `No radar file found for ${date}` };
  }

  let html = readFileSync(radarFile, "utf-8");

  // Build the data attribute to search for — supports task paths and email IDs
  const dataAttr = options.path
    ? `data-task-path="${options.path}"`
    : options.email_id
      ? `data-email-id="${options.email_id}"`
      : null;

  if (!dataAttr) {
    return { error: "missing_identifier", message: "Provide either path (for tasks) or email_id (for emails)" };
  }

  if (!html.includes(dataAttr)) {
    return { error: "item_not_found", message: `No item with ${dataAttr} in radar` };
  }

  const escapedAttr = dataAttr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (options.state === "resolved") {
    // Find elements with this data attribute and add resolved class + opacity
    html = html.replace(
      new RegExp(`(<(?:div|li)[^>]*${escapedAttr}[^>]*>)`, "g"),
      (match) => {
        let tag = match;
        // Add resolved class
        if (tag.includes('class="')) {
          tag = tag.replace(/class="([^"]*)"/, 'class="$1 resolved"');
        } else {
          tag = tag.replace(/>$/, ' class="resolved">');
        }
        // Add opacity style
        if (tag.includes('style="')) {
          tag = tag.replace(/style="([^"]*)"/, 'style="$1 opacity: 0.4;"');
        } else {
          tag = tag.replace(/>$/, ' style="opacity: 0.4;">');
        }
        return tag;
      },
    );

    // If an explanation was provided, append it as a sub-line after the matched element's closing children
    if (options.explanation) {
      html = html.replace(
        new RegExp(`(<(?:div|li)[^>]*${escapedAttr}[^>]*>[\\s\\S]*?)(</(?:div|li)>)`, ""),
        (match, before, closingTag) => {
          return `${before}      <div class="radar-sub" style="color: var(--green); font-style: italic; margin-top: 4px;">✓ ${escapeHtml(options.explanation!)}</div>\n    ${closingTag}`;
        },
      );
    }
  } else {
    // Remove resolved class and opacity from elements with this data attribute
    html = html.replace(
      new RegExp(`(<(?:div|li)[^>]*${escapedAttr}[^>]*>)`, "g"),
      (match) => {
        let tag = match;
        tag = tag.replace(/ resolved/g, "");
        tag = tag.replace(/ opacity: 0\.4;/g, "");
        // Clean up empty style/class attributes
        tag = tag.replace(/ style=""/g, "");
        tag = tag.replace(/ class=""/g, "");
        return tag;
      },
    );
  }

  writeFileSync(radarFile, html, "utf-8");
  return { path: options.path, email_id: options.email_id, state: options.state, updated: true };
}

// Types re-exported from ./types.ts (see export at top of file)
import type { TaskRow, EventRow, EmailRow } from "./types.js";

// ─── HTML Renderer ────────────────────────────────────────────────────────

function renderRadarHtml(data: {
  date: string;
  overdueTasks: TaskRow[];
  activeTasks: TaskRow[];
  waitingTasks: TaskRow[];
  calendarEvents: EventRow[];
  emailHighlights: EmailRow[];
  sidecarPort?: number;
  sidecarToken?: string;
}): string {
  const { date, overdueTasks, activeTasks, waitingTasks, calendarEvents, emailHighlights, sidecarPort, sidecarToken } = data;

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
  const tokenMeta = sidecarToken ? `<meta name="radar-token" content="${escapeHtml(sidecarToken)}">` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${portMeta}
${tokenMeta}
<title>Daily Radar \u2014 ${date}</title>
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
.resolved { opacity: 0.4; }
.resolved .radar-title, .resolved .radar-sub, .resolved .radar-label,
.resolved .loop-title, .resolved .loop-sub,
.resolved .event-title, .resolved .event-time, .resolved .event-meta { text-decoration: line-through; }
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
    <div class="loop-section-title">\uD83D\uDFE0 Active \u2014 High Priority</div>
${highPriority.map((t) => loopItemHtml(t, "p-orange")).join("\n")}
  </div>
` : ""}
${mediumPriority.length > 0 ? `
  <div class="loop-section">
    <div class="loop-section-title">\uD83D\uDFE1 Active \u2014 Medium/Low</div>
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
const TOKEN = document.querySelector('meta[name="radar-token"]')?.content;

async function resync() {
  if (!PORT) { alert('Start Claude Code to enable sync'); return; }
  const btn = document.getElementById('syncBtn');
  btn.classList.add('syncing');
  try {
    const res = await fetch('http://127.0.0.1:' + PORT + '/sync', {
      method: 'POST',
      headers: TOKEN ? { 'X-Radar-Token': TOKEN } : {},
    });
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
  emailId?: string;
}

function radarItemHtml(item: RadarStripItem, tier: string): string {
  const dataAttr = item.taskPath
    ? ` data-task-path="${escapeHtml(item.taskPath)}"`
    : item.emailId
      ? ` data-email-id="${escapeHtml(item.emailId)}"`
      : "";
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
  ].filter(Boolean).join(" \u00B7 ");
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
  const sub = [dueSub, waitingOn].filter(Boolean).join(" \u00B7 ");
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
      emailId: email.id,
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
      sub: `Needs RSVP \u00B7 ${formatEventTime(event)}`,
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
    emailId: email.id,
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
  return end ? `${fmt(start)} \u2014 ${fmt(end)}` : fmt(start);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
