---
name: daily-radar
description: >
  Generate a dark-themed daily radar briefing by pulling from Gmail, Google Calendar, and
  the Obsidian vault (via MCP tools). Produces a single self-contained HTML file with a
  radar strip of urgent items, a timeline schedule, open loops grouped by priority, and
  waiting-for items — all with clickable source links back to Gmail, Calendar, and Obsidian.

  MANDATORY TRIGGERS: daily briefing, daily radar, morning briefing, what's on my radar,
  what's on my plate, check my email and calendar, standup prep, start of day, open loops,
  schedule overview, day at a glance, radar report. Also trigger when the user asks to
  "check Gmail and Calendar" together, or asks for a combined view of their schedule +
  tasks + emails. Trigger even if they don't say "radar" — if they want a synthesized
  view of their day from multiple sources, this is the skill.
---

# Daily Radar

Build a single-page dark-themed HTML briefing that synthesizes a user's day from up to
three sources: Google Calendar, Gmail, and an Obsidian vault. The output is a self-contained
`.html` file the user can open in any browser.

## Why this skill exists

Managers and ICs waste 20+ minutes each morning piecing together their day from email,
calendar, and task lists. This skill does that collection in one shot and presents it in a
scannable format with direct links back to every source so the user can act immediately.

---

## 1. Data Collection

**CRITICAL: NEVER use Claude.ai's `gcal_*` or `gmail_*` MCP connector tools for the
radar.** Those connectors only have access to a single Google account. The plugin's own
MCP tools pull from ALL registered Google accounts (personal, work, etc.) via the vault's
SQLite database. Always use the plugin tools described below.

### Path A — radar_generate (Preferred)

If the `radar_generate` MCP tool is available, call it:

```
radar_generate({ })
```

This is the fastest path. It syncs all accounts, gathers all data (tasks, calendar, email),
renders the full HTML radar, writes the file, and creates a daily note — all server-side.
You do NOT need to render HTML yourself. Just present the verbal summary after it returns.

### Path B — radar_data (Data Only)

If `radar_generate` is not available but `radar_data` is (v0.8.0+ vaults with SQLite):

```
radar_data({ lookahead_days: 3 })
```

This returns all data in a single call: tasks (overdue/active/waiting with `next_action`),
per-project next actions, inbox count, stuck projects, calendar events from ALL accounts,
email highlights from ALL accounts, and CLAUDE.md context.

Use this data for all sections below and render the HTML yourself.

### Path C — Individual Vault MCP Tools (Fallback)

If neither composite tool is available, use the plugin's individual vault MCP tools:

1. **`claudemd_read`** — get the user's working memory (org chart, projects, terminology)
2. **`task_list`** — pull all tasks grouped by status
3. **`account_sync`** — trigger a sync of all registered Google accounts
4. Then query tasks, calendar, and email data from the vault's SQLite index

**Do NOT fall back to Claude.ai's `gcal_list_events`, `gmail_search_messages`, or any
`gcal_*`/`gmail_*` connector tools.** If the plugin MCP tools are unavailable, report
which sources are missing rather than substituting single-account connectors.

---

## 2. Synthesis — The Hard Part

This is where the value is. Don't just dump raw data into sections. Cross-reference
sources and surface what matters.

### Building the Radar Strip

The radar strip is the most important section — it's the first thing the user sees. Each
item should be a short, high-signal card. Classify items into three tiers.

### Inbox Count Badge

If `inbox_count > 0` from `radar_data`, add a badge in the radar header:

```
📡 Daily Radar — Monday, March 30  📥 3 inbox items
```

Omit when inbox is empty.

---

### Radar Strip Classification

Classify items into three tiers:

**🔥 Fire (red)** — needs action today or is overdue:
- Overdue vault tasks (due date in the past, status still active)
- Starred/urgent emails requiring immediate response
- Status reports or deliverables due today
- Chase emails (someone following up for the 2nd+ time)

**👀 Watch (orange)** — upcoming deadlines, blocked items, prep needed:
- Tasks due within the next 7 days — state what the task is, not just "due soon"
- Waiting-for items that are blocking something — name the specific deliverable
- Meetings next week that need prep — say what prep is needed (agenda item, doc, question)
- Anything with a deadline approaching that hasn't been addressed
- Stuck projects (no active tasks defined)

### Stuck Project Detection

If `stuck_projects` from `radar_data` is non-empty, add Watch-tier cards for each:

```
👀 WATCH
● Project Phoenix
  ⚠ No active tasks defined — needs next actions
```

**ℹ️ FYI (gray)** — awareness items, no action needed:
- Interesting emails (announcements, FYIs from leadership)
- Interview pipeline updates
- Resolved alerts (Fivetran errors that cleared, etc.)

**Cross-referencing is key.** If the user has a vault task "Taylor performance review (due
Mar 16)" and a calendar event "Taylor / Tony 1:1" today, the radar item should connect
them: flag the overdue review AND note that today's 1:1 is the window to close it. Same
with waiting-for items — if you're waiting on Gavrilo for something and there's a 1:1 with
Gavrilo on Monday, note that on the radar card.

### Radar Card Content Rules

**Every radar card must include the substance of what it's about.** A card that says
"Ryan — waiting" is useless. The user needs to know *what* they're waiting on Ryan for
without clicking through. Include the specific task, deliverable, or question.

Bad example (too vague):
```
👀 WATCH — STALE 18 DAYS
Ryan — waiting (longest)
18 days with no update. Send a follow-up today.
  [waiting]  ← links to itself
```

Good example (includes content and real links):
```
👀 WATCH — 12 DAYS OUTSTANDING
WF Gavrilo — 2 blocked AWS/Iguazio items
Waiting since Mar 14 on: (1) EC2 reserved instance savings $$ for AWS Optimization,
(2) Iguazio AWS savings estimate for Erica. No Gavrilo meeting on calendar — nudge needed.
  [📓 WF EC2]  [📓 WF Iguazio]  ← each links to the actual vault task
```

Rules:
- **Title**: name the specific deliverable or topic, not just the person
- **Description**: include what you're waiting for, what's due, what prep is needed, or
  what action to take — the user should be able to act from the card alone
- **Source chips must link to the original source** — the Gmail thread, Calendar event, or
  Obsidian task file. Never link a chip back to the radar card itself. If there are multiple
  source items (e.g., two waiting-for tasks for the same person), show a separate chip for
  each with its own link.

### Building the Schedule

Show a timeline for each day in the lookahead window.

**Time format — always show start AND end times:**
- Timed events: `6:05–7:00 AM`, `10:00–10:30 AM`, `1:00–1:30 PM`
- All-day events: `All Day`
- Never show just a start time with no end time (e.g., "10:00 AM" alone is wrong)

**Only show data from the calendar.** Do not fabricate event details, descriptions, or
attendee information. If the calendar event has no description, show just the title and
time. Vault task annotations (badges) are allowed because they come from a real source,
but the event itself must match what the calendar API returned.

For each event:

- **Color-code by type**: meetings (accent blue), conflicts (orange), needs-RSVP (yellow),
  focus/admin blocks (green, dimmed), personal (teal), declined (gray, dimmed)
- **Flag conflicts** — if two events overlap, mark both with a CONFLICT badge and add a
  note saying what they overlap with
- **Flag unresolved RSVPs** — events where `myResponseStatus` is `needsAction`
- **Annotate with context** — if a meeting connects to a vault task or an email thread,
  add a badge (e.g., "⚡ Iguazio sunset due Mar 31" on a Nemanja 1:1 when there's a
  related vault task). These annotations must come from real vault/email data.
- **Dim declined events** — show them but at reduced opacity so the user knows they exist

If there are conflicts or pending RSVPs, add a yellow warning banner at the top of the
schedule section summarizing the count.

### Building Open Loops

Group by priority tier, in this order:

1. **🔥 Overdue** — tasks past their due date
2. **🟠 Active — High Priority** — high-priority tasks + actionable emails
3. **🟡 Active — Medium** — medium-priority tasks
4. **⏳ Waiting For** — tasks with `status: waiting`
5. **🏠 Personal** — tasks with `context: personal`

Each item gets a colored priority dot and source link chips. For waiting-for items, include
who you're waiting on and how long you've been waiting.

### Per-Project Next Actions

For each open loop item, if `next_action` is available from `radar_data`, add a sub-line:

```
🔥 OVERDUE
● Review budget proposal                         📓 tasks
  → Next: Pull Q1 actuals from finance portal
  Due: Mar 25 (4 days overdue)
```

Only show the `→ Next:` line when `next_action` is not null.

### Stale Waiting-For Escalation

- Show days waiting for each waiting-for item (from `days_waiting` field)
- Items waiting **14+ days**: promote to the Watch column in the radar strip with "⚠ Waiting N days — escalate?"
- If `upcoming_meeting` is not null: show a calendar badge, e.g., "📅 1:1 with Todd in 2 days — follow up?"

---

## 3. HTML Output

Generate a single self-contained HTML file. All CSS must be inline in a `<style>` tag —
no external dependencies. Use the dark theme defined below.

### Page Structure

```
┌─────────────────────────────────────────────┐
│  Header: "[Name]'s Radar"  ·  date  ·  tz   │
├─────────────────────────────────────────────┤
│  Radar Strip (full width, 3-column grid)     │
│  🔥 Fire items  │  👀 Watch items  │ ℹ️ FYI  │
├──────────────────────┬──────────────────────┤
│  Schedule (left)     │  Open Loops (right)   │
│  Timeline per day    │  Grouped by priority  │
│  with colored dots   │  with source chips    │
├──────────────────────┴──────────────────────┤
│  Legend bar                                   │
└─────────────────────────────────────────────┘
```

### Design System

Use these design tokens for the dark theme:

| Token       | Value     | Use                    |
|------------|-----------|------------------------|
| `--bg`     | `#0f1117` | Page background        |
| `--surface`| `#1a1d27` | Card backgrounds       |
| `--surface2`| `#22263a`| Nested elements        |
| `--border` | `#2e3354` | Borders, dividers      |
| `--accent` | `#5c6ef8` | Default meeting color  |
| `--accent2`| `#7c8bfa` | Hover / highlights     |
| `--red`    | `#e05252` | Fire / overdue         |
| `--orange` | `#e8933a` | Conflict / watch       |
| `--yellow` | `#d4b84a` | Needs RSVP             |
| `--green`  | `#4caf78` | Focus / admin blocks   |
| `--teal`   | `#3fb8b8` | Personal events        |
| `--muted`  | `#6b7280` | Declined / low-priority|
| `--text`   | `#e2e5f0` | Primary text           |
| `--text2`  | `#9ba3bc` | Secondary text         |

### Full CSS Template

Inline this entire CSS block in the `<style>` tag of the output HTML:

```css
:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --surface2: #22263a;
  --border: #2e3354;
  --accent: #5c6ef8;
  --accent2: #7c8bfa;
  --red: #e05252;
  --orange: #e8933a;
  --yellow: #d4b84a;
  --green: #4caf78;
  --teal: #3fb8b8;
  --muted: #6b7280;
  --text: #e2e5f0;
  --text2: #9ba3bc;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  padding: 24px;
}

/* ── HEADER ── */
.header {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 28px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 16px;
}
.header h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }
.header .date { color: var(--muted); font-size: 13px; }

/* ── LAYOUT ── */
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px;
}
.card-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--muted);
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.card-title .dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent);
  display: inline-block;
}

/* ── SOURCE LINK CHIPS ── */
a.src {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  color: var(--muted);
  text-decoration: none;
  opacity: 0.7;
  margin-left: 5px;
  vertical-align: middle;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  gap: 3px;
  white-space: nowrap;
  transition: opacity 0.15s, color 0.15s;
}
a.src:hover { opacity: 1; color: var(--accent2); border-color: var(--accent2); }

/* ── RADAR STRIP ── */
.radar-full {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px;
  margin-bottom: 20px;
}
.radar-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 4px;
}
@media (max-width: 700px) { .radar-grid { grid-template-columns: 1fr; } }
.radar-item {
  background: var(--surface2);
  border-radius: 8px;
  padding: 12px 14px;
  border-left: 3px solid var(--border);
}
.radar-item.fire  { border-left-color: var(--red); }
.radar-item.watch { border-left-color: var(--orange); }
.radar-item.fyi   { border-left-color: var(--muted); }
.radar-label {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.6px;
  margin-bottom: 4px;
}
.radar-item.fire  .radar-label { color: var(--red); }
.radar-item.watch .radar-label { color: var(--orange); }
.radar-item.fyi   .radar-label { color: var(--muted); }
.radar-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 3px; }
.radar-sub   { font-size: 11px; color: var(--text2); }
.radar-sources { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }

/* ── SCHEDULE TIMELINE ── */
.schedule-day { margin-bottom: 18px; }
.day-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent2);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.timeline {
  position: relative;
  padding-left: 16px;
}
.timeline::before {
  content: '';
  position: absolute;
  left: 5px; top: 0; bottom: 0;
  width: 1px;
  background: var(--border);
}
.event {
  position: relative;
  margin-bottom: 8px;
  background: var(--surface2);
  border-radius: 7px;
  padding: 8px 10px;
  border-left: 3px solid var(--accent);
}
.event::before {
  content: '';
  position: absolute;
  left: -19px; top: 12px;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--bg);
}
.event.conflict       { border-left-color: var(--orange); }
.event.conflict::before { background: var(--orange); }
.event.personal       { border-left-color: var(--teal); }
.event.personal::before { background: var(--teal); }
.event.focus          { border-left-color: var(--green); opacity: 0.7; }
.event.focus::before  { background: var(--green); }
.event.needs-rsvp     { border-left-color: var(--yellow); }
.event.needs-rsvp::before { background: var(--yellow); }
.event.declined       { border-left-color: var(--muted); opacity: 0.4; }
.event.declined::before { background: var(--muted); }
.event-time {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 2px;
}
.event-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text);
}
.event-meta {
  font-size: 11px;
  color: var(--text2);
  margin-top: 2px;
}

/* ── BADGES ── */
.badge {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
  margin-left: 4px;
}
.badge-orange { background: rgba(232,147,58,0.2); color: var(--orange); }
.badge-yellow { background: rgba(212,184,74,0.2); color: var(--yellow); }
.badge-red    { background: rgba(224,82,82,0.2); color: var(--red); }
.badge-blue   { background: rgba(92,110,248,0.2); color: var(--accent2); }
.badge-gray   { background: rgba(107,114,128,0.2); color: var(--muted); }

/* ── OPEN LOOPS ── */
.loop-section { margin-bottom: 14px; }
.loop-section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.loop-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid rgba(46,51,84,0.5);
}
.loop-item:last-child { border-bottom: none; }
.loop-text  { flex: 1; }
.loop-title { font-weight: 500; font-size: 13px; color: var(--text); }
.loop-sub   { font-size: 11px; color: var(--text2); margin-top: 1px; }
.priority-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 6px;
}
.p-red    { background: var(--red); }
.p-orange { background: var(--orange); }
.p-yellow { background: var(--yellow); }
.p-muted  { background: var(--muted); }

/* ── CONFLICT BANNER ── */
.conflict-note {
  background: rgba(232,147,58,0.1);
  border: 1px solid rgba(232,147,58,0.3);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--orange);
  margin-bottom: 12px;
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

/* ── LEGEND ── */
.legend {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
  align-items: center;
}
.legend-swatch {
  display: inline-block;
  width: 10px; height: 10px;
  border-radius: 2px;
  margin-right: 4px;
}
```

### Source Link Chips

Every item that came from an external source must have a clickable chip linking back to it.
Format:

```html
<a class="src" href="URL" target="_blank">📧 Label</a>
<a class="src" href="URL" target="_blank">📅 Label</a>
<a class="src" href="obsidian://open?file=PATH" target="_blank">📓 Label</a>
```

For Gmail links, use: `https://mail.google.com/mail/u/0/#inbox/MESSAGE_ID`
For Calendar links, use the event's `htmlLink`
For Obsidian tasks, use: `obsidian://open?file=tasks%2FFILENAME` (URL-encode the path)

### Schedule Timeline

Each day gets a vertical timeline with a thin line on the left and colored dots for each
event. The `.event-time` element must always show the full time range (`start–end`), e.g.,
`7:00–7:30 AM` or `All Day`. Never show a bare start time without an end time.

Use CSS classes to control the event color:

- `.event` — default (accent blue border)
- `.event.conflict` — orange border
- `.event.personal` — teal border
- `.event.focus` — green border, dimmed opacity
- `.event.needs-rsvp` — yellow border
- `.event.declined` — gray border, heavy dimming

### Badges

Small inline pills for status indicators:

```html
<span class="badge badge-orange">CONFLICT</span>
<span class="badge badge-yellow">RSVP</span>
<span class="badge badge-red">⚠ Overdue</span>
<span class="badge badge-blue">Context note</span>
<span class="badge badge-gray">DECLINED</span>
```

---

## 4. File Output

If you used `radar_generate` (Path A), the HTML file and daily note are already written
by the server. Skip to the verbal summary.

Otherwise, save the file as `radar-YYYY-MM-DD.html` in the current working directory.

After the file is ready, give a brief verbal summary (3-5 bullets) of the most important
things on their radar — the fires and anything they should act on immediately. Keep it
concise; the HTML has all the detail.

---

## 5. Handling Missing Sources

If a source isn't available:

- **No Calendar**: Skip the schedule section entirely. The radar strip and open loops still
  work from Gmail + vault.
- **No Gmail**: Skip email-derived radar items. Calendar + vault still produce a useful
  schedule + task view.
- **No Vault**: No task cross-referencing. The radar strip comes entirely from email
  signals. Schedule shows raw calendar events without task annotations.
- **Only one source**: Still produce the radar. Even a calendar-only view with conflict
  detection and RSVP flags is useful.

Add a small note at the bottom listing which sources were used.

**Reminder:** Never substitute Claude.ai's `gcal_*`/`gmail_*` connectors for missing
plugin tools. Those connectors only see one Google account and will produce an incomplete
radar. Report the gap instead.
