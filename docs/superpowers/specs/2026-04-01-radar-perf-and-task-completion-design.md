# Radar Performance & Seamless Task Completion

**Date:** 2026-04-01
**Branch:** `fix/radar-performance-and-task-completion`

## Problem

1. **Radar generation is slow.** `radarGenerate()` syncs all 4 Google accounts sequentially before rendering. Each account requires token refresh, calendar list, per-calendar event fetches, Gmail message list, and individual message detail fetches — potentially 100+ sequential network round-trips. Additionally, `radarData()` in composite.ts makes N+1 DB queries (2 per project) for next actions and stuck project detection.

2. **Task completion from the radar is disconnected.** `task_complete` only updates the vault file. `radar_update_item` only updates the HTML. Claude must figure out to call both, and may prompt the user for clarification — breaking the seamless flow the user expects.

## Design

### 1. Parallel Account Sync

**File:** `plugin/mcp-server/src/tools/external.ts` — `accountSync()`

Replace the sequential `for...of` + `await` loop (line 115) with `Promise.allSettled()` so all registered accounts sync concurrently. Failed accounts still get reported without blocking others.

**File:** `plugin/mcp-server/src/google-api.ts` — `syncAccount()`

Run `fetchCalendarEvents()` and `fetchEmails()` in parallel with `Promise.all()` since they are independent API calls to different Google services.

**Impact:** 4 accounts syncing in parallel instead of series. Calendar + email fetched concurrently per account. ~4x wall-clock improvement on the sync phase.

### 2. Batched Project Queries

**File:** `plugin/mcp-server/src/tools/composite.ts` — `radarData()`

Replace the two per-project loops (lines 336-381) with batch queries:

- **Next actions:** Single query joining project notes against task notes with `ROW_NUMBER() OVER (PARTITION BY project)` window function to get the top-priority task per project in one pass.
- **Stuck projects:** Single LEFT JOIN query — active projects where no matching active task exists (`COUNT = 0`).

Remove the redundant source availability COUNT queries (lines 422-429). Calendar and email data are already fetched at that point — just check `array.length > 0`.

**Impact:** ~20 queries reduced to 2 queries, plus 2 redundant COUNTs eliminated. DB phase becomes negligible.

### 3. Unified Task Completion + Radar Update

**File:** `plugin/mcp-server/src/tools/tasks.ts` — `taskComplete()`

After completing the vault task (frontmatter update + file move), check if `radar-{today}.html` exists in the vault root. If so, call `radarUpdateItem()` internally with `state: "resolved"` to strike through all instances of the task in the radar HTML (both radar strip and open loops section).

**Return value extended:**
```typescript
{
  old_path: string;
  new_path: string;
  completed: string;
  radar_updated: boolean;  // NEW — true if radar HTML was also updated
}
```

The existing `radar_update_item` MCP tool remains available for non-task items (emails, calendar events) but task completion is fully automatic.

**Import:** `taskComplete()` gains a dependency on `radarUpdateItem()` from `./radar.js`.

**Impact:** User says "mark it done" → one `task_complete` call → vault task completed + radar HTML strikethrough on all matching instances. No prompts, no second tool call.

## Files Changed

| File | Change |
|------|--------|
| `plugin/mcp-server/src/tools/external.ts` | `accountSync()` — parallel `Promise.allSettled()` |
| `plugin/mcp-server/src/google-api.ts` | `syncAccount()` — parallel calendar + email fetch |
| `plugin/mcp-server/src/tools/composite.ts` | `radarData()` — batched project queries, remove redundant COUNTs |
| `plugin/mcp-server/src/tools/tasks.ts` | `taskComplete()` — auto-call `radarUpdateItem()` after completion |

## Out of Scope

- Staleness-gated sync (skip sync if recent) — could be added later
- Background sync pipeline / sidecar architecture changes
- Gmail batch API (individual message fetches remain sequential per account, but accounts run in parallel)
- HTML template extraction to static file (minor perf, not worth the complexity)
