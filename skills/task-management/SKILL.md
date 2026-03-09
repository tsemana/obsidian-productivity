---
name: task-management
description: >
  Obsidian-native task management using a shared TASKS.md file with wikilinks to people, projects,
  and notes. Reference this when the user asks about their tasks, wants to add/complete tasks, or
  needs help tracking commitments. Tasks link into the vault's memory system and can be viewed
  through Obsidian Bases.
---

# Task Management (Obsidian-Native)

Tasks are tracked in a simple `TASKS.md` file that both you and the user can edit. Tasks use wikilinks to connect to people, projects, and notes in the vault.

## File Location

**Always use `TASKS.md` in the current working directory (vault root).**

- If it exists, read/write to it
- If it doesn't exist, create it with the template below

## Dashboard Setup (First Run)

A visual dashboard is available for managing tasks and memory. **On first interaction with tasks:**

1. Check if `dashboard.html` exists in the current working directory
2. If not, copy it from `${CLAUDE_PLUGIN_ROOT}/dashboard.html` to the current working directory
3. Inform the user: "I've added the dashboard. Run `/start` to set up the full system."

The task board:
- Reads and writes to the same `TASKS.md` file
- Auto-saves changes
- Watches for external changes (syncs when you edit via CLI)
- Supports drag-and-drop reordering of tasks and sections

## Format & Template

When creating a new TASKS.md, use this exact template (without example tasks):

```markdown
---
title: Tasks
tags:
  - dashboard
aliases:
  - Task List
  - Todo
---

# Tasks

## Active

## Waiting On

## Someday

## Done
```

Task format:
- `- [ ] **Task title** — context, for [[Person]], due date`
- Sub-bullets for additional details
- Use `[[wikilinks]]` for people and projects
- Completed: `- [x] ~~Task~~ (date)`

### Dual-Context Vaults

In vaults with both work and personal contexts, prefix each task with a context tag for visual scanning:

- `- [ ] [work] **Task title** — context`
- `- [ ] [personal] **Task title** — context`

The prefix makes it easy to scan for context-relevant tasks at a glance. When the active session context is known, new tasks are automatically prefixed.

### Example Tasks

**Single-context vault:**

```markdown
## Active
- [ ] **Review budget proposal** — for [[Sarah Chen|Sarah]], due Friday
  - See [[Q2 Budget Draft]] for latest version
- [ ] **Draft Q2 roadmap** — after syncing with [[Greg Wilson|Greg]]
  - Blocked until [[Project Phoenix]] status is clear

## Waiting On
- [ ] **Phoenix cost estimate** — waiting on [[Todd Martinez|Todd]] since Jan 15

## Done
- [x] ~~**Submit expense report**~~ (2025-01-18)
```

**Dual-context vault:**

```markdown
## Active
- [ ] [work] **Review budget proposal** — for [[Sarah Chen|Sarah]], due Friday
  - See [[Q2 Budget Draft]] for latest version
- [ ] [personal] **Book dentist appointment** — [[Dr. Sarah Patel|Dr. Patel]], before end of month
- [ ] [work] **Draft Q2 roadmap** — after syncing with [[Greg Wilson|Greg]]
- [ ] [personal] **Research kitchen countertops** — for [[Kitchen Renovation|kitchen reno]]

## Waiting On
- [ ] [work] **Phoenix cost estimate** — waiting on [[Todd Martinez|Todd]] since Jan 15
- [ ] [personal] **Contractor quote** — waiting on [[Jamie Lee|Jamie]] since Mar 1

## Done
- [x] [work] ~~**Submit expense report**~~ (2025-01-18)
- [x] [personal] ~~**Order new running shoes**~~ (2025-01-20)
```

## How to Interact

**When user asks "what's on my plate" / "my tasks":**
- Read TASKS.md
- Summarize Active and Waiting On sections
- Highlight anything overdue or urgent
- Resolve wikilinks to provide context (e.g., "the task for Sarah about the budget proposal")

**When user says "add a task" / "remind me to":**
- Add to Active section with `- [ ] **Task**` format
- In dual-context vaults, prefix with `[work]` or `[personal]` based on the active session context
- Include context if provided (who it's for, due date)
- Use `[[wikilinks]]` for any people, projects, or notes mentioned
- If a person is mentioned, link to their memory note: `[[Todd Martinez|Todd]]`

**When user says "done with X" / "finished X":**
- Find the task
- Change `[ ]` to `[x]`
- Add strikethrough: `~~task~~`
- Add completion date
- Move to Done section

**When user asks "what am I waiting on":**
- Read the Waiting On section
- Note how long each item has been waiting
- Resolve wikilinks to show who/what you're waiting on

## Conventions

- **Bold** the task title for scannability
- Include "for [[Person]]" when it's a commitment to someone
- Include "due [date]" for deadlines
- Include "since [date]" for waiting items
- Use `[[wikilinks]]` for all people, projects, and related notes
- Sub-bullets for additional context, with links to relevant vault notes
- Keep Done section for ~1 week, then clear old items

## Extracting Tasks

When summarizing meetings or conversations, offer to add extracted tasks:
- Commitments the user made ("I'll send that over")
- Action items assigned to them
- Follow-ups mentioned

Ask before adding — don't auto-add without confirmation. When adding, link to the source note if one exists (e.g., `from [[Meeting Notes 2025-01-20]]`).

## Obsidian Bases Integration

A task tracker Base can provide database-like views of tasks. See the vault-workflow skill for the pre-built `tasks.base` file that creates filtered views of TASKS.md and all notes tagged with `#task`.
