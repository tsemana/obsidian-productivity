---
description: Initialize the Obsidian vault productivity system and open the dashboard
---

# Start Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Initialize the task and memory systems inside an Obsidian vault, then open the unified dashboard.

## Instructions

### 1. Check What Exists

Check the working directory for:
- `TASKS.md` — task list
- `CLAUDE.md` — working memory
- `memory/` — deep memory directory
- `dashboard.html` — the visual UI
- `daily/` — daily notes folder
- `templates/` — note templates
- `bases/` — Obsidian Bases views

### 2. Create What's Missing

**If vault structure doesn't exist:** Create all folders and files per the vault-workflow skill:
- Folders: `daily/`, `projects/`, `references/`, `memory/`, `memory/people/`, `memory/projects/`, `memory/context/`, `templates/`, `bases/`, `canvas/`
- Templates: `templates/daily.md`, `templates/person.md`, `templates/project.md`, `templates/meeting.md`, `templates/reference.md`
- Bases: `bases/tasks.base`, `bases/projects.base`, `bases/people.base`
- Core files: `memory/glossary.md`, `memory/context/company.md`

**If `TASKS.md` doesn't exist:** Create it with the standard template (see task-management skill). Include frontmatter with `tags: [dashboard]` and `aliases: [Task List, Todo]`.

**If `dashboard.html` doesn't exist:** Copy it from `${CLAUDE_PLUGIN_ROOT}/dashboard.html` to the current working directory.

**If `CLAUDE.md` and `memory/` don't exist:** This is a fresh setup — after opening the dashboard, begin the memory bootstrap workflow (see below).

### 3. Open the Dashboard

Do NOT use `open` or `xdg-open` — in Cowork, the agent runs in a VM and shell open commands won't reach the user's browser. Instead, tell the user: "Dashboard is ready at `dashboard.html`. Open it from your file browser to get started."

### 4. Orient the User

If everything was already initialized:
```
Vault is set up. Your tasks, memory, and Obsidian views are all loaded.
- /update to sync tasks and check memory
- /update --comprehensive for a deep scan of all activity

Your vault structure:
- daily/ for daily notes
- projects/ for working project notes
- references/ for research and meeting notes
- memory/ for people, projects, and glossary
- bases/ for database views (tasks, projects, people)
- templates/ for consistent note creation
```

If memory hasn't been bootstrapped yet, continue to step 5 (context detection) and then step 6 (memory bootstrap).

### 5. Detect Context Mode (First Run Only)

Before bootstrapping memory, determine if this will be a single-context or dual-context vault.

**Ask the user:**
```
Do you use this vault from a single Claude account, or do you switch between
accounts (e.g., one for work, one for personal)?

1. Single account — one context, no tagging needed
2. Multiple accounts — I'll set up context tagging so work and personal
   stay organized in the same vault
```

**If dual-context:**
- Ask what contexts they use (defaults: "work" and "personal")
- Ask which account they're on right now
- Set the active context for this session
- Context-filtered Bases views will be created in step 2 (vault structure)
- CLAUDE.md will be structured with context-scoped sections

**If single-context:**
- Skip all context tagging
- Proceed normally

### 6. Bootstrap Memory (First Run Only)

Only do this if `CLAUDE.md` and `memory/` don't exist yet.

The best source of workplace language is the user's actual task list. Real tasks = real shorthand.

**Ask the user:**
```
Where do you keep your todos or task list? This could be:
- A local file (e.g., TASKS.md, todo.txt)
- An app (e.g. Asana, Linear, Jira, Notion, Todoist)
- A notes file

I'll use your tasks to learn your workplace shorthand.
```

**Once you have access to the task list:**

For each task item, analyze it for potential shorthand:
- Names that might be nicknames
- Acronyms or abbreviations
- Project references or codenames
- Internal terms or jargon

**For each item, decode it interactively:**

```
Task: "Send PSR to Todd re: Phoenix blockers"

I see some terms I want to make sure I understand:

1. **PSR** - What does this stand for?
2. **Todd** - Who is Todd? (full name, role)
3. **Phoenix** - Is this a project codename? What's it about?
```

Continue through each task, asking only about terms you haven't already decoded.

### 7. Optional Comprehensive Scan

After task list decoding, offer:
```
Do you want me to do a comprehensive scan of your messages, emails, and documents?
This takes longer but builds much richer context about the people, projects, and terms in your work.

Or we can stick with what we have and add context later.
```

**If they choose comprehensive scan:**

Gather data from available MCP sources:
- **Chat:** Recent messages, channels, DMs
- **Email:** Sent messages, recipients
- **Documents:** Recent docs, collaborators
- **Calendar:** Meetings, attendees

Build a braindump of people, projects, and terms found. Present findings grouped by confidence:
- **Ready to add** (high confidence) — offer to add directly
- **Needs clarification** — ask the user
- **Low frequency / unclear** — note for later

### 8. Write Memory Files

From everything gathered, create all memory files using Obsidian conventions:

**CLAUDE.md** (working memory) — per memory-management skill format, with wikilinks.
- **Single-context:** ~50-80 lines, flat structure
- **Dual-context:** Includes a `## Contexts` table mapping contexts to their connectors, followed by context-scoped sections (`## Work — People`, `## Personal — People`, etc.)

**memory/** directory — per memory-management skill format:
- `memory/glossary.md` — full decoder ring with wikilinks to people/project notes
- `memory/people/{name}.md` — individual profiles with frontmatter `aliases`, `tags: [person]`, and wikilinks. In dual-context vaults, include `context: work` or `context: personal` in frontmatter.
- `memory/projects/{name}.md` — project details with frontmatter `aliases`, `tags: [project]`, and wikilinks. Include `context` in frontmatter.
- `memory/context/company.md` — teams, tools, processes with wikilinks

**Dual-context only:** Also create context-filtered Bases views:
- `bases/work-tasks.base`, `bases/personal-tasks.base`
- `bases/work-people.base`, `bases/personal-people.base`

### 9. Report Results

```
Productivity system ready:
- Tasks: TASKS.md (X items)
- Memory: X people, X terms, X projects
- Vault: folders, templates, and Bases views created
- Dashboard: open from your file browser

Use /update to keep things current (add --comprehensive for a deep scan).

Open your vault in Obsidian to explore the graph view — you'll see
how people, projects, and tasks are all connected.
```

## Notes

- If memory is already initialized, this just opens the dashboard
- Nicknames are critical — always capture as frontmatter `aliases`
- All people/project notes must use wikilinks for cross-referencing
- If a source isn't available, skip it and note the gap
- Memory grows organically through natural conversation after bootstrap

### Dual-Context: Running /start from the Second Account

When the user switches to their second account and runs `/start`:

1. Detect that the vault already exists (folders, CLAUDE.md, memory/)
2. Read CLAUDE.md — find the `## Contexts` table
3. Check current connectors — they'll differ from the first account
4. Identify this as the second context (e.g., "personal" if "work" was first)
5. Run the memory bootstrap for this context only — pull from the current account's connectors
6. Add new people/project notes with the appropriate context tag
7. Update CLAUDE.md with the new context's sections (e.g., `## Personal — People`)
8. Create context-filtered Bases views if not already present
9. Do NOT re-bootstrap the first context's memory — that data is already there
