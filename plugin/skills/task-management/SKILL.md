---
name: task-management
description: >
  Obsidian-native task management using individual task notes in a tasks/ folder.
  Each task is its own note with frontmatter properties (status, priority, due, context, project).
  Tasks are viewed and filtered through Obsidian Bases. Reference this when the user asks about
  their tasks, wants to add/complete tasks, or needs help tracking commitments. Tasks link into
  the vault's memory system via wikilinks.
---

# Task Management (Obsidian-Native)

Every task is its own note in the `tasks/` folder. Completed tasks move to `tasks/done/`. Tasks are viewed through Obsidian Bases, which provide filtered, sorted, grouped views over the task notes.

## Folder Structure

```
tasks/                  ← Active, waiting, and someday tasks
  review-budget.md
  book-dentist.md
  draft-q2-roadmap.md
tasks/done/             ← Completed tasks (archived)
  submit-expense-report.md
```

## Task Note Format

Every task note uses this frontmatter structure:

```markdown
---
title: Review budget proposal
aliases:
  - budget review
tags:
  - task
context: work
status: active
priority: medium
due: 2026-03-14
assigned-to: "[[Sarah Chen|Sarah]]"
project: "[[Project Phoenix]]"
created: 2026-03-10
---

# Review budget proposal

For [[Sarah Chen|Sarah]], need to finalize before Q2 planning.

## Subtasks
- [ ] Pull latest numbers from finance
- [ ] Compare against Q1 actuals
- [ ] Send draft to [[Todd Martinez|Todd]] for review

## Blockers
- Waiting on [[Todd Martinez|Todd]] for cost estimate

## Related
- [[Q2 Budget Draft]]
- [[2026-03-08]] — discussed in standup

## Log
- 2026-03-10: Created, waiting on Todd's numbers
```

### Frontmatter Properties

| Property | Values | Required |
|----------|--------|----------|
| `title` | Task name | Yes |
| `tags` | Always includes `task` | Yes |
| `status` | `active`, `waiting`, `someday`, `done` | Yes |
| `priority` | `high`, `medium`, `low` | Yes (default: `medium`) |
| `due` | `YYYY-MM-DD` or empty | No |
| `context` | `work`, `personal`, or `[work, personal]` | Only in dual-context vaults |
| `assigned-to` | Wikilink to person | No |
| `project` | Wikilink to project | No |
| `waiting-on` | Wikilink to person (when status is `waiting`) | No |
| `waiting-since` | `YYYY-MM-DD` | No |
| `created` | `YYYY-MM-DD` | Yes |
| `completed` | `YYYY-MM-DD` (set when done) | No |
| `aliases` | Short names for the task | No |

### Filename Convention

Lowercase, hyphenated, descriptive: `review-budget-proposal.md`, `book-dentist-appointment.md`. Keep it short but recognizable.

## How to Interact

**When user asks "what's on my plate" / "my tasks":**
- Read all notes in `tasks/` (not `tasks/done/`)
- Filter by active session context if in a dual-context vault
- Summarize by status: active first, then waiting, then someday
- Highlight anything overdue (due date < today) or high priority
- Resolve wikilinks to provide context (e.g., "the budget review for Sarah, due Friday")

**When user says "add a task" / "remind me to":**
- Create a new note in `tasks/` using the task note format
- Set `status: active` and `created: [today]`
- In dual-context vaults, set `context` based on the active session context
- Use `[[wikilinks]]` for any people, projects, or notes mentioned
- If a person is mentioned, link to their memory note in `assigned-to`
- Set `priority` based on urgency cues (default: `medium`)
- Set `due` if a deadline is mentioned
- Even simple tasks ("buy milk") get their own note — keep the body minimal if there's nothing to add

**When user says "done with X" / "finished X":**
- Use the `task_complete` MCP tool — it handles everything in one call:
  - Updates frontmatter: `status: done`, adds `completed: [today]`
  - Moves the file from `tasks/` to `tasks/done/`
  - Auto-updates today's radar HTML (strikes out the item in both the radar strip and open loops)
- Check the `radar_updated` field in the response:
  - If `true`: the radar HTML was updated — the item is now struck through and dimmed
  - If `false`: today's radar HTML doesn't exist yet (no update needed)
  - If `radar_updated` is missing or you used `task_update` + `note_move` instead: manually call `radar_update_item` with `{ path: "tasks/original-filename.md", state: "resolved" }` to strike it out
- Confirm to the user what was completed and whether the radar was updated

**When user says "waiting on X for Y":**
- Find or create the task note
- Update frontmatter: `status: waiting`, add `waiting-on: "[[Person]]"`, add `waiting-since: [today]`
- Note in the body what you're waiting for

**When user asks "what am I waiting on":**
- Read all notes in `tasks/` where `status: waiting`
- Show who you're waiting on and how long (days since `waiting-since`)

**When user says "put X on the back burner" / "someday":**
- Update frontmatter: `status: someday`
- Task stays in `tasks/` but won't show in active views

## Quick Capture

Even for tiny tasks, create a note. The note can be minimal:

```markdown
---
title: Buy milk
tags:
  - task
context: personal
status: active
priority: low
created: 2026-03-10
---

# Buy milk
```

The overhead of a file is negligible. The benefit is that every task is searchable, filterable, and visible in Bases views — no task gets lost in a long list.

## Extracting Tasks

When summarizing meetings or conversations, offer to create task notes for:
- Commitments the user made ("I'll send that over")
- Action items assigned to them
- Follow-ups mentioned

Ask before creating — don't auto-create without confirmation. When creating, link to the source note if one exists (e.g., add `[[Meeting Notes 2026-03-10]]` to the Related section).

## Conventions

- One task per file, always in `tasks/`
- Completed tasks move to `tasks/done/` (not deleted)
- `tags: [task]` is mandatory — this is what Bases filters on
- Use `[[wikilinks]]` for all people, projects, and related notes
- Keep filenames short and descriptive
- Subtasks live as checkboxes inside the task note body — they don't get their own files
- The `## Log` section captures progress updates over time
- When a task is referenced from a daily note, use `[[Task Name]]` to create a backlink

## Obsidian Bases Integration

Task notes are viewed through Bases files in `bases/`. The primary view is `tasks.base`, which shows all active tasks sorted by priority and due date. Context-filtered views (`work-tasks.base`, `personal-tasks.base`) show tasks scoped to a single context. See the vault-workflow skill for the full Bases definitions.
