---
description: Sync tasks and refresh memory from your current activity
argument-hint: "[--comprehensive]"
---

# Update Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Keep your tasks and memory current. Two modes:

- **Default:** Sync tasks from external tools, triage stale items, check memory for gaps
- **`--comprehensive`:** Deep scan chat, email, calendar, docs — flag missed todos and suggest new memories

## Usage

```bash
/update
/update --comprehensive
```

## Default Mode

### 1. Load Current State

Read task notes in `tasks/` and `memory/` directory. If they don't exist, suggest `/start` first.

### 2. Sync Tasks from External Sources

Check for available task sources:
- **Project tracker** (e.g. Asana, Linear, Jira) (if MCP available)
- **GitHub Issues** (if in a repo): `gh issue list --assignee=@me`

If no sources are available, skip to Step 3.

**Fetch tasks assigned to the user** (open/in-progress). Compare against task notes in `tasks/`:

| External task | Task note match? | Action |
|---------------|-----------------|--------|
| Found, no matching note | No match | Offer to create task note |
| Found, matching note exists | Match by title (fuzzy) | Skip |
| Task note exists, not in external | No match | Flag as potentially stale |
| Completed externally | Still in `tasks/` (not done/) | Offer to mark done and move to `tasks/done/` |

Present diff and let user decide what to add/complete.

### 3. Triage Stale Items

Review task notes in `tasks/` and flag:
- Tasks with due dates in the past
- Tasks with `status: active` for 30+ days (check `created` date)
- Tasks with no assigned-to or project

Present each for triage: Mark done? Reschedule? Move to someday?

### 4. Decode Tasks for Memory Gaps

For each task note, attempt to decode all entities (people, projects, acronyms, tools, links):

```
Task: "Send PSR to Todd re: Phoenix blockers"

Decode:
- PSR → ✓ Pipeline Status Report (in glossary)
- Todd → ✓ [[Todd Martinez]] (in people/)
- Phoenix → ? Not in memory
```

Track what's fully decoded vs. what has gaps.

### 5. Fill Gaps

Present unknown terms grouped:
```
I found terms in your tasks I don't have context for:

1. "Phoenix" (from: "Send PSR to Todd re: Phoenix blockers")
   → What's Phoenix?

2. "Maya" (from: "sync with Maya on API design")
   → Who is Maya?
```

Add answers to the appropriate memory files:
- New people → create `memory/people/{name}.md` with frontmatter `aliases` and `tags: [person]`
- New projects → create `memory/projects/{name}.md` with frontmatter `aliases` and `tags: [project]`
- New terms → add to `memory/glossary.md`
- Update wikilinks in task notes to use proper `[[links]]`

### 6. Capture Enrichment

Tasks often contain richer context than memory. Extract and update:
- **Links** from tasks → add to project/people files
- **Status changes** ("launch done") → update project status property, demote from CLAUDE.md
- **Relationships** ("Todd's sign-off on Maya's proposal") → add wikilinks cross-referencing people
- **Deadlines** → add to project frontmatter

### 7. Report

```
Update complete:
- Tasks: +3 from project tracker, 1 completed (moved to done/), 2 triaged
- Memory: 2 gaps filled, 1 project enriched
- All tasks decoded ✓
- Vault links updated ✓
```

## Comprehensive Mode (`--comprehensive`)

Everything in Default Mode, plus a deep scan of recent activity.

### Extra Step: Scan Activity Sources

Gather data from available MCP sources:
- **Chat:** Search recent messages, read active channels
- **Email:** Search sent messages
- **Documents:** List recently touched docs
- **Calendar:** List recent + upcoming events

### Extra Step: Flag Missed Todos

Compare activity against task notes. Surface action items that aren't tracked:

```
## Possible Missing Tasks

From your activity, these look like todos you haven't captured:

1. From chat (Jan 18):
   "I'll send the updated mockups by Friday"
   → Create task note?

2. From meeting "Phoenix Standup" (Jan 17):
   You have a recurring meeting but no Phoenix tasks active
   → Anything needed here?

3. From email (Jan 16):
   "I'll review the API spec this week"
   → Create task note?
```

Let user pick which to add. When creating task notes, use wikilinks for any people/projects mentioned and set context based on the active session.

### Extra Step: Suggest New Memories

Surface new entities not in memory:

```
## New People (not in memory)
| Name | Frequency | Context |
|------|-----------|---------|
| Maya Rodriguez | 12 mentions | design, UI reviews |
| Alex K | 8 mentions | DMs about API |

## New Projects/Topics
| Name | Frequency | Context |
|------|-----------|---------|
| Starlight | 15 mentions | planning docs, product |

## Suggested Cleanup
- **[[Project Horizon]]** — No mentions in 30 days. Mark completed?
```

Present grouped by confidence. High-confidence items offered to add directly as proper Obsidian notes with frontmatter; low-confidence items asked about.

### Extra Step: Create Daily Note

If today's daily note doesn't exist, offer to create it in `daily/` using the daily template, pre-populated with:
- Today's active tasks (from task notes with `status: active`)
- Upcoming meetings from calendar
- Key items from the scan

## Notes

- Never auto-add tasks or memories without user confirmation
- External source links are preserved when available
- Fuzzy matching on task titles handles minor wording differences
- Safe to run frequently — only updates when there's new info
- `--comprehensive` always runs interactively
- All new memory notes must include frontmatter with aliases and tags
- All references to people/projects must use `[[wikilinks]]`
