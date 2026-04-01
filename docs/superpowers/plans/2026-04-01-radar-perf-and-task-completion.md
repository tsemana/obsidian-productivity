# Radar Performance & Seamless Task Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make radar generation ~4x faster via parallelization and batched queries, and make task completion automatically update the radar HTML.

**Architecture:** Parallelize Google account syncs with `Promise.allSettled()`, parallelize per-account calendar+email fetches with `Promise.all()`, batch N+1 project queries into single SQL statements, and wire `taskComplete()` to auto-call `radarUpdateItem()` as a side-effect.

**Tech Stack:** TypeScript, better-sqlite3, Google Calendar/Gmail APIs, Node.js `fs`

**Spec:** `docs/superpowers/specs/2026-04-01-radar-perf-and-task-completion-design.md`

**No test framework is configured.** Verification is via `npm run build` (TypeScript compilation) and runtime smoke testing.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `plugin/mcp-server/src/google-api.ts` | Modify | Parallelize calendar + email fetches in `syncAccount()` |
| `plugin/mcp-server/src/tools/external.ts` | Modify | Parallelize account loop in `accountSync()` |
| `plugin/mcp-server/src/tools/composite.ts` | Modify | Batch project queries, remove redundant COUNTs in `radarData()` |
| `plugin/mcp-server/src/tools/tasks.ts` | Modify | Auto-call `radarUpdateItem()` in `taskComplete()` |

---

### Task 1: Parallelize calendar + email fetches in `syncAccount()`

**Files:**
- Modify: `plugin/mcp-server/src/google-api.ts:249-323`

- [ ] **Step 1: Parallelize the two independent fetch calls**

In `syncAccount()`, replace the sequential calendar-then-email fetch with `Promise.all()`. The two fetches are independent (different Google APIs).

Current code (lines 261-292):
```typescript
  // Sync calendar
  const events = await fetchCalendarEvents(token, { timeZone: options.timeZone });
  // ... upsert logic ...

  // Sync email
  const emails = await fetchEmails(token, email);
  // ... upsert logic ...
```

Replace with:
```typescript
  // Fetch calendar and email in parallel — independent APIs
  const [events, emails] = await Promise.all([
    fetchCalendarEvents(token, { timeZone: options.timeZone }),
    fetchEmails(token, email),
  ]);
```

Keep the DB upsert logic exactly as-is after the parallel fetch — the upserts are sequential (same DB) and fast.

The full function becomes:

```typescript
export async function syncAccount(
  db: DatabaseType,
  accountId: string,
  email: string,
  options: {
    timeZone?: string;
  } = {},
): Promise<{ calendar_events_synced: number; emails_synced: number }> {
  const token = await getAccessToken(db, accountId);
  const now = Date.now();

  // Fetch calendar and email in parallel — independent APIs
  const [events, emails] = await Promise.all([
    fetchCalendarEvents(token, { timeZone: options.timeZone }),
    fetchEmails(token, email),
  ]);

  // Upsert calendar events
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
    deleteStaleEvents.run(accountId, now);
  })();

  // Upsert emails
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

  db.prepare("UPDATE external_accounts SET last_synced_at = ? WHERE id = ?").run(now, accountId);

  return { calendar_events_synced: events.length, emails_synced: emails.length };
}
```

- [ ] **Step 2: Build and verify**

Run: `cd plugin/mcp-server && npm run build`
Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/google-api.ts
git commit -m "perf: parallelize calendar + email fetches in syncAccount()"
```

---

### Task 2: Parallelize account sync loop in `accountSync()`

**Files:**
- Modify: `plugin/mcp-server/src/tools/external.ts:78-137`

- [ ] **Step 1: Replace sequential loop with `Promise.allSettled()`**

In `accountSync()`, replace the `for...of` loop (lines 115-134) with parallel execution. Use `Promise.allSettled()` so failed accounts don't block others.

Current code:
```typescript
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
```

Replace with:
```typescript
  const settled = await Promise.allSettled(
    accounts.map((account) =>
      syncAccount(db, account.id, account.account_email, {
        timeZone: options.timeZone,
      }).then((result) => ({
        id: account.id,
        email: account.account_email,
        ...result,
      })),
    ),
  );

  const results: Array<{
    id: string;
    email: string;
    calendar_events_synced: number;
    emails_synced: number;
    error?: string;
  }> = settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") return outcome.value;
    return {
      id: accounts[i].id,
      email: accounts[i].account_email,
      calendar_events_synced: 0,
      emails_synced: 0,
      error: String(outcome.reason),
    };
  });
```

**Note on DB concurrency:** better-sqlite3 is synchronous and single-threaded — the DB upserts in `syncAccount()` are fine because they're fast synchronous calls between async suspension points. The parallelism is in the network I/O (Google API fetches), not the DB writes.

- [ ] **Step 2: Clean up the now-unused `results` declaration**

The `results` array declaration at line 107-113 can be removed since we now declare it inline from the `settled.map()`. The full function becomes:

```typescript
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

  const settled = await Promise.allSettled(
    accounts.map((account) =>
      syncAccount(db, account.id, account.account_email, {
        timeZone: options.timeZone,
      }).then((result) => ({
        id: account.id,
        email: account.account_email,
        ...result,
      })),
    ),
  );

  const results = settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") return outcome.value;
    return {
      id: accounts[i].id,
      email: accounts[i].account_email,
      calendar_events_synced: 0,
      emails_synced: 0,
      error: String(outcome.reason),
    };
  });

  return { accounts: results };
}
```

- [ ] **Step 3: Build and verify**

Run: `cd plugin/mcp-server && npm run build`
Expected: Clean compilation, no errors.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/src/tools/external.ts
git commit -m "perf: parallelize account sync with Promise.allSettled()"
```

---

### Task 3: Batch project queries in `radarData()`

**Files:**
- Modify: `plugin/mcp-server/src/tools/composite.ts:263-444`

- [ ] **Step 1: Replace the per-project next-actions loop with a single batched query**

Replace lines 336-355 (the `for...of` loop querying one task per project) with a single query using a subquery to rank tasks per project.

Current code:
```typescript
  const projectNextActions: ProjectNextAction[] = [];
  for (const proj of projectNotes) {
    const slug = proj.path.replace(/^memory\/projects\//, "").replace(/\.md$/, "");
    const topTask = db.prepare(`
      SELECT path, title, priority, due, body_preview, frontmatter_json FROM notes
      WHERE tags LIKE '%"task"%' AND status = 'active'
      AND (project = ? OR project LIKE ?)
      AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
      ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due ASC NULLS LAST
      LIMIT 1
    `).get(slug, `%${slug}%`) as TaskRow | undefined;

    projectNextActions.push({
      project_path: proj.path,
      project_title: proj.title,
      task_path: topTask?.path ?? null,
      task_title: topTask?.title ?? null,
      next_action: topTask ? extractNextAction(topTask.body_preview) : null,
    });
  }
```

Replace with:
```typescript
  // Batch: get top-priority task per project in a single query
  // Build slug list from project notes
  const projectSlugs = projectNotes.map((p) => p.path.replace(/^memory\/projects\//, "").replace(/\.md$/, ""));

  // Fetch all active tasks that belong to any known project, ranked by priority
  const allProjectTasks = db.prepare(`
    SELECT path, title, priority, due, body_preview, frontmatter_json, project FROM notes
    WHERE tags LIKE '%"task"%' AND status = 'active'
    AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    AND project IS NOT NULL
    ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due ASC NULLS LAST
  `).all() as (TaskRow & { project: string })[];

  // Index: for each slug, find the first (highest priority) matching task
  const topTaskBySlug = new Map<string, TaskRow & { project: string }>();
  for (const task of allProjectTasks) {
    for (const slug of projectSlugs) {
      if (!topTaskBySlug.has(slug) && (task.project === slug || task.project.includes(slug))) {
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
```

- [ ] **Step 2: Replace the per-project stuck-projects loop with a single computation**

Replace lines 364-381 (the `for...of` loop counting tasks per project) by reusing the `allProjectTasks` array from step 1.

Current code:
```typescript
  const stuckProjects: StuckProject[] = [];
  for (const proj of projectNotes) {
    const slug = proj.path.replace(/^memory\/projects\//, "").replace(/\.md$/, "");
    const countRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM notes
      WHERE tags LIKE '%"task"%' AND status = 'active'
      AND (project = ? OR project LIKE ?)
      AND path LIKE 'tasks/%' AND path NOT LIKE 'tasks/done/%'
    `).get(slug, `%${slug}%`) as { cnt: number };

    if (countRow.cnt === 0) {
      stuckProjects.push({
        path: proj.path,
        title: proj.title,
        active_task_count: 0,
      });
    }
  }
```

Replace with:
```typescript
  // Stuck projects: active projects with no matching active tasks
  // Reuses allProjectTasks from the batch query above — no additional DB queries
  const stuckProjects: StuckProject[] = projectNotes
    .filter((_, i) => !topTaskBySlug.has(projectSlugs[i]))
    .map((proj) => ({
      path: proj.path,
      title: proj.title,
      active_task_count: 0,
    }));
```

**Note:** A project is "stuck" if it has zero active tasks, which is exactly the case where `topTaskBySlug` has no entry for that slug. This reuses the already-fetched data with zero additional queries.

- [ ] **Step 3: Remove redundant source availability COUNT queries**

Replace lines 419-429:

Current code:
```typescript
  const vaultAvailable = true;
  let calendarAvailable = false;
  let emailAvailable = false;
  try {
    const calCount = (db.prepare("SELECT COUNT(*) as cnt FROM calendar_events").get() as { cnt: number }).cnt;
    calendarAvailable = calCount > 0;
  } catch {}
  try {
    const emailCount = (db.prepare("SELECT COUNT(*) as cnt FROM email_cache").get() as { cnt: number }).cnt;
    emailAvailable = emailCount > 0;
  } catch {}
```

Replace with:
```typescript
  const vaultAvailable = true;
  const calendarAvailable = calendarEvents.length > 0;
  const emailAvailable = emails.length > 0;
```

- [ ] **Step 4: Build and verify**

Run: `cd plugin/mcp-server && npm run build`
Expected: Clean compilation, no errors.

- [ ] **Step 5: Commit**

```bash
git add plugin/mcp-server/src/tools/composite.ts
git commit -m "perf: batch project queries and remove redundant COUNTs in radarData()"
```

---

### Task 4: Auto-update radar HTML on task completion

**Files:**
- Modify: `plugin/mcp-server/src/tools/tasks.ts:1-8,123-150`

- [ ] **Step 1: Add import for `radarUpdateItem`**

Add the import at the top of tasks.ts (after existing imports, line 7):

```typescript
import { radarUpdateItem } from "./radar.js";
```

- [ ] **Step 2: Modify `taskComplete()` to auto-update radar**

Replace the current `taskComplete()` function (lines 123-150) with a version that calls `radarUpdateItem()` after completing the vault task:

```typescript
/** task_complete — mark task done, move to tasks/done/, and update today's radar */
export function taskComplete(
  vaultPath: string,
  path: string,
  db?: DatabaseType,
): { old_path: string; new_path: string; completed: string; radar_updated: boolean } | { error: string; message: string } {
  const completed = todayStr();

  // Update frontmatter first
  const updateResult = taskUpdate(vaultPath, path, {
    frontmatter: { status: "done", completed },
  });
  if ("error" in updateResult) return updateResult;

  // Move to tasks/done/
  const filename = basename(path);
  const newPath = `tasks/done/${filename}`;

  const moveResult = noteMove(vaultPath, path, newPath);
  if ("error" in moveResult) return moveResult;

  if (db) {
    reindexFile(db, vaultPath, path);    // removes old (file no longer at old path)
    reindexFile(db, vaultPath, newPath); // indexes new location
  }

  // Auto-update today's radar HTML if it exists
  let radar_updated = false;
  const radarResult = radarUpdateItem(vaultPath, { path, state: "resolved" });
  if (!("error" in radarResult)) {
    radar_updated = radarResult.updated;
  }

  return { old_path: path, new_path: newPath, completed, radar_updated };
}
```

**Key details:**
- The radar update is best-effort — if no radar file exists for today or the item isn't found, `radar_updated` is `false` and the task still completes successfully.
- `radarUpdateItem()` already handles striking through ALL instances of a `data-task-path` in the HTML (radar strip + open loops) via its global regex replacement.

- [ ] **Step 3: Build and verify**

Run: `cd plugin/mcp-server && npm run build`
Expected: Clean compilation, no errors.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/src/tools/tasks.ts
git commit -m "feat: auto-update radar HTML on task completion"
```

---

### Task 5: Rebuild dist and final verification

**Files:**
- Modify: `plugin/mcp-server/dist/*` (compiled output)

- [ ] **Step 1: Full clean build**

Run: `cd plugin/mcp-server && rm -rf dist && npm run build`
Expected: Clean compilation, all 4 modified source files produce updated `.js` and `.d.ts` in `dist/`.

- [ ] **Step 2: Verify dist files are updated**

Run: `ls -la plugin/mcp-server/dist/google-api.js plugin/mcp-server/dist/tools/external.js plugin/mcp-server/dist/tools/composite.js plugin/mcp-server/dist/tools/tasks.js`
Expected: All 4 files have today's date as modification time.

- [ ] **Step 3: Spot-check compiled output for key changes**

Verify the parallelization made it to dist:
- `dist/google-api.js` should contain `Promise.all([`
- `dist/tools/external.js` should contain `Promise.allSettled(`
- `dist/tools/tasks.js` should contain `radarUpdateItem(`
- `dist/tools/composite.js` should NOT contain the old `for (const proj of projectNotes)` loop with `db.prepare` inside it

Run: `grep -l "Promise.all" plugin/mcp-server/dist/google-api.js && grep -l "Promise.allSettled" plugin/mcp-server/dist/tools/external.js && grep -l "radarUpdateItem" plugin/mcp-server/dist/tools/tasks.js`
Expected: All three files listed.

- [ ] **Step 4: Commit dist**

```bash
git add plugin/mcp-server/dist/
git commit -m "chore: rebuild dist after perf + task completion changes"
```
