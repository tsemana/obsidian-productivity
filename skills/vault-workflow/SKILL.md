---
name: vault-workflow
description: >
  Obsidian vault structure, daily notes workflow, and templates for the productivity system.
  Use when initializing a vault, creating daily notes, setting up templates, or when the user
  asks about vault organization, folder structure, or how things connect in their Obsidian vault.
  Also use when creating Bases views for tasks, projects, or people.
---

# Vault Workflow

How the Obsidian vault is organized and how all the pieces connect: tasks, memory, daily notes, projects, and references.

## Vault Structure

```
vault-root/
├── CLAUDE.md              ← Working memory (hot cache)
├── tasks/                 ← Active task notes (one per task)
│   └── done/              ← Completed task notes (archived)
├── daily/                 ← Daily notes (YYYY-MM-DD.md)
├── projects/              ← Project notes (one per project)
├── references/            ← Research, articles, meeting notes
├── memory/
│   ├── glossary.md        ← Full decoder ring
│   ├── people/            ← Person profiles
│   ├── projects/          ← Project detail notes
│   └── context/           ← Company, teams, tools
├── templates/             ← Note templates
├── bases/                 ← Obsidian Bases views
│   ├── tasks.base
│   ├── projects.base
│   └── people.base
└── canvas/                ← Visual canvases
```

### Folder Purposes

- **tasks/** — One note per task. Each task has frontmatter with status, priority, due date, context. Completed tasks move to `tasks/done/`.
- **daily/** — Daily notes auto-created by date. Capture quick thoughts, meeting notes, and task updates throughout the day. Link to people and projects freely.
- **projects/** — One note per active project. These are the "working" notes you edit — distinct from memory/projects/ which are the reference profiles.
- **references/** — Long-lived reference material: articles, specs, research, meeting notes.
- **memory/** — The productivity plugin's knowledge base. People profiles, project metadata, glossary, company context.
- **templates/** — Obsidian templates for consistent note creation.
- **bases/** — Obsidian Bases files for database-like views.
- **canvas/** — Visual canvases for brainstorming and project mapping.

## Daily Notes

Daily notes are the primary capture surface. They connect the day's work to the vault.

### Daily Note Template (`templates/daily.md`)

```markdown
---
title: "{{date:YYYY-MM-DD}}"
date: {{date:YYYY-MM-DD}}
tags:
  - daily
---

# {{date:dddd, MMMM D, YYYY}}

## Plan
- [ ]

## Notes


## Log

```

**Note on dual-context vaults:** Daily notes are NOT pre-tagged with a context. A single day's note may contain both work and personal items. The daily note captures everything; context lives on the linked notes (people, projects, tasks), not the daily note itself.

### How Daily Notes Connect

When writing daily notes, link generously:
- Mention a person → `[[Todd Martinez|Todd]]`
- Reference a project → `[[Project Phoenix|Phoenix]]`
- Capture a task → create a task note in `tasks/` and link it: `[[Review budget proposal]]`
- Meeting notes → create in references/ and link from daily note

## Templates

### Person Template (`templates/person.md`)

In dual-context vaults, Claude adds `context: work` or `context: personal` when creating the note. The template itself stays context-free so it works for both.

```markdown
---
title:
aliases: []
tags:
  - person
context:
role:
team:
reports-to:
---

# {{title}}

**Role:** {{role}} | **Team:** {{team}}

## Communication
- Preferred channel:
- Best time:
- Style:

## Context


## Notes

```

### Project Template (`templates/project.md`)

```markdown
---
title:
aliases: []
tags:
  - project
context:
status: active
launch:
budget:
---

# {{title}}

## Overview


## Key People


## Timeline
- [ ]

## Context

```

### Meeting Notes Template (`templates/meeting.md`)

```markdown
---
title:
date: {{date:YYYY-MM-DD}}
tags:
  - meeting
attendees: []
project:
---

# {{title}}

**Date:** {{date:YYYY-MM-DD}}
**Attendees:**

## Agenda


## Notes


## Action Items
- [ ]

```

### Task Template (`templates/task.md`)

Every task gets its own note. See the task-management skill for the full format and interaction patterns.

```markdown
---
title:
aliases: []
tags:
  - task
context:
status: active
priority: medium
due:
assigned-to:
project:
created: {{date:YYYY-MM-DD}}
---

# {{title}}

## Description


## Subtasks
- [ ]

## Blockers


## Related
-

## Log

```

### Reference Template (`templates/reference.md`)

```markdown
---
title:
date: {{date:YYYY-MM-DD}}
tags:
  - reference
source:
---

# {{title}}

## Summary


## Key Points


## Related
-

```

## Obsidian Bases Views

### Task Tracker (`bases/tasks.base`)

```yaml
filters:
  and:
    - file.hasTag("task")

formulas:
  days_until_due: 'if(due, (date(due) - today()).days, "")'
  is_overdue: 'if(due, date(due) < today() && status != "done", false)'
  priority_icon: 'if(priority == "high", "🔴", if(priority == "medium", "🟡", "🟢"))'

properties:
  formula.days_until_due:
    displayName: "Days Left"
  formula.priority_icon:
    displayName: "Priority"

views:
  - type: table
    name: "Active Tasks"
    filters:
      and:
        - 'status != "done"'
    order:
      - file.name
      - status
      - formula.priority_icon
      - due
      - formula.days_until_due
    groupBy:
      property: status
      direction: ASC

  - type: table
    name: "Completed"
    filters:
      and:
        - 'status == "done"'
    order:
      - file.name
      - completed
    limit: 20
```

### Projects Dashboard (`bases/projects.base`)

```yaml
filters:
  and:
    - file.hasTag("project")

formulas:
  status_icon: 'if(status == "active", "🟢", if(status == "on-hold", "🟡", if(status == "completed", "✅", "📋")))'
  days_since_update: '(now() - file.mtime).days.round(0)'

properties:
  formula.status_icon:
    displayName: ""
  formula.days_since_update:
    displayName: "Days Since Update"

views:
  - type: table
    name: "All Projects"
    order:
      - formula.status_icon
      - file.name
      - status
      - launch
      - formula.days_since_update

  - type: cards
    name: "Project Cards"
    order:
      - file.name
      - status
      - launch
```

### People Directory (`bases/people.base`)

```yaml
filters:
  and:
    - file.hasTag("person")

formulas:
  recent_mentions: '(now() - file.mtime).days.round(0)'

properties:
  formula.recent_mentions:
    displayName: "Days Since Referenced"

views:
  - type: table
    name: "Team Directory"
    order:
      - file.name
      - role
      - team
      - formula.recent_mentions
    groupBy:
      property: team
      direction: ASC

  - type: cards
    name: "People Cards"
    order:
      - file.name
      - role
      - team
```

### Context-Filtered Views (Dual-Context Vaults Only)

When the vault uses dual contexts, create additional Bases views that filter by context. These supplement the main views above.

**Work Tasks (`bases/work-tasks.base`):**

```yaml
filters:
  and:
    - file.hasTag("task")
    - 'context == "work"'

views:
  - type: table
    name: "Work Tasks"
    filters:
      and:
        - 'status != "done"'
    order:
      - file.name
      - status
      - due
```

**Personal Tasks (`bases/personal-tasks.base`):**

```yaml
filters:
  and:
    - file.hasTag("task")
    - 'context == "personal"'

views:
  - type: table
    name: "Personal Tasks"
    filters:
      and:
        - 'status != "done"'
    order:
      - file.name
      - status
      - due
```

**Work People (`bases/work-people.base`):**

```yaml
filters:
  and:
    - file.hasTag("person")
    - 'context == "work"'

views:
  - type: table
    name: "Work Contacts"
    order:
      - file.name
      - role
      - team
```

**Personal People (`bases/personal-people.base`):**

```yaml
filters:
  and:
    - file.hasTag("person")
    - 'context == "personal"'

views:
  - type: table
    name: "Personal Contacts"
    order:
      - file.name
      - role
```

The main views (tasks.base, projects.base, people.base) remain unfiltered so you can always see everything.

## Vault Initialization

When setting up a new vault (via `/start` command), create:

1. Core folders: `tasks/`, `tasks/done/`, `daily/`, `projects/`, `references/`, `memory/`, `memory/people/`, `memory/projects/`, `memory/context/`, `templates/`, `bases/`, `canvas/`
2. Template files in `templates/`
3. Base files in `bases/`
4. CLAUDE.md at vault root
5. memory/glossary.md
6. memory/context/company.md (skeleton)

Then run the memory bootstrap workflow to seed the knowledge base from the user's existing tasks, calendar, and communications.

## Linking Philosophy

The power of this system comes from linking. Follow these principles:

1. **Link people by wikilink** — `[[Todd Martinez|Todd]]` not just "Todd"
2. **Link projects by wikilink** — `[[Project Phoenix|Phoenix]]` not just "Phoenix"
3. **Link from daily notes** — every daily note should link to the people and projects touched that day
4. **Link tasks to context** — task notes use wikilinks for assigned-to, project, and related notes
5. **Use aliases** — frontmatter `aliases` lets you link naturally (`[[Todd]]` resolves to `[[Todd Martinez]]`)
6. **Tags for filtering** — `#person`, `#project`, `#daily`, `#meeting`, `#reference`, `#task` enable Bases views
7. **Backlinks are free** — Obsidian automatically shows what links to any note, building a web of context
