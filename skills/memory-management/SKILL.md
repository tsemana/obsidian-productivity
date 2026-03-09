---
name: memory-management
description: >
  Two-tier memory system that makes Claude a true workplace collaborator, adapted for Obsidian vaults.
  Decodes shorthand, acronyms, nicknames, and internal language so Claude understands requests like
  a colleague would. CLAUDE.md for working memory, memory/ directory for the full knowledge base.
  All memory files use Obsidian Flavored Markdown with wikilinks, frontmatter properties, and aliases
  so they integrate naturally into the vault's link graph and search.
  Use this skill whenever the user asks about people, projects, terms, or workplace context, or when
  decoding shorthand in any request.
---

# Memory Management (Obsidian-Native)

Memory makes Claude your workplace collaborator — someone who speaks your internal language. All memory files live in the Obsidian vault as proper linked notes.

## Session Context Detection

This vault may be used from multiple Claude accounts (e.g., one for work, one for personal). At the **start of every session**, determine the active context:

### Detection Flow

1. **Read CLAUDE.md** — check for a `## Contexts` section that lists configured contexts (e.g., `work`, `personal`)
2. **If contexts exist** — check which connectors are available in this session:
   - If connectors match a known context profile (e.g., work Slack + work Gmail → `work`), set that context automatically
   - If ambiguous, ask once: "Is this a work or personal session?"
3. **If no contexts configured** — this is a single-context vault. Skip context tagging entirely.

### Context Profiles (in CLAUDE.md)

```markdown
## Contexts

| Context | Connectors | Description |
|---------|-----------|-------------|
| work | Slack (company workspace), Gmail (work@company.com), Google Calendar (work) | Work account |
| personal | Gmail (personal@gmail.com), Google Calendar (personal) | Personal account |
```

### How Context Affects Behavior

Once the active context is determined for the session:

- **Every new file** gets `context: work` or `context: personal` in frontmatter (in addition to other tags)
- **TASKS.md** — new tasks get a `[work]` or `[personal]` prefix in the task title for visual scanning
- **CLAUDE.md reads** — when summarizing, prioritize entries matching the active context
- **Memory lookups** — search all memory regardless of context (a work colleague might appear in a personal task), but note the context when presenting results
- **Bases views** — context-filtered views exist alongside the "all" views

**Important:** Context is a *soft* tag, not a hard boundary. All memory is always searchable. Context just helps with auto-tagging new content and filtering views.

## The Goal

Transform shorthand into understanding:

```
User: "ask todd to do the PSR for oracle"
              ↓ Claude decodes
"Ask Todd Martinez (Finance lead) to prepare the Pipeline Status Report
 for the Oracle Systems deal ($2.3M, closing Q2)"
```

Without memory, that request is meaningless. With memory, Claude knows:
- **todd** → Todd Martinez, Finance lead, prefers Slack
- **PSR** → Pipeline Status Report (weekly sales doc)
- **oracle** → Oracle Systems deal, not the company

## Architecture

```
CLAUDE.md          ← Hot cache (~30 people, common terms)
memory/
  glossary.md      ← Full decoder ring (everything)
  people/          ← Complete profiles (one note per person)
  projects/        ← Project details (one note per project)
  context/         ← Company, teams, tools
```

**CLAUDE.md (Hot Cache):**
- Top ~30 people you interact with most
- ~30 most common acronyms/terms
- Active projects (5-15)
- Your preferences
- **Goal: Cover 90% of daily decoding needs**

**memory/glossary.md (Full Glossary):**
- Complete decoder ring — everyone, every term
- Searched when something isn't in CLAUDE.md
- Can grow indefinitely

**memory/people/, projects/, context/:**
- Rich detail when needed for execution
- Full profiles, history, context
- Each file is a proper Obsidian note with frontmatter and wikilinks

## Obsidian Integration Rules

All memory files follow Obsidian conventions so they participate in the vault's link graph.

### People Notes (`memory/people/{name}.md`)

Use frontmatter with `aliases` so wikilinks resolve from nicknames. Include `context` when the vault uses dual contexts:

```markdown
---
title: Todd Martinez
aliases:
  - Todd
  - T
tags:
  - person
  - finance
context: work
role: Finance Lead
team: Finance
reports-to: "[[Michael Chen]]"
---

# Todd Martinez

**Role:** Finance Lead | **Team:** Finance
**Reports to:** [[Michael Chen]] (CFO)

## Communication
- Prefers Slack DM
- Quick responses, very direct
- Best time: mornings

## Context
- Handles all [[PSR]]s and financial reporting
- Key contact for deal approvals over $500k
- Works closely with [[Greg Wilson|Greg]] on forecasting

## Notes
- Cubs fan, likes talking baseball
```

Because `aliases` includes "Todd", typing `[[Todd]]` in any vault note will link to this file.

### Project Notes (`memory/projects/{name}.md`)

```markdown
---
title: Project Phoenix
aliases:
  - Phoenix
  - the migration
tags:
  - project
  - active
context: work
status: in-progress
launch: Q2 2025
budget: $1.2M
---

# Project Phoenix

Database migration from legacy Oracle to PostgreSQL.

## Key People
- [[Sarah Chen|Sarah]] — tech lead
- [[Todd Martinez|Todd]] — budget owner
- [[Greg Wilson|Greg]] — stakeholder (sales impact)

## Context
$1.2M budget, 6-month timeline. Critical path for [[Project Horizon|Horizon]].

## Timeline
- [ ] Schema migration — due Feb 15
- [ ] Data migration — due Mar 30
- [ ] Cutover — due Q2
```

### Glossary (`memory/glossary.md`)

```markdown
---
title: Glossary
tags:
  - reference
---

# Glossary

Workplace shorthand, acronyms, and internal language.

## Acronyms
| Term | Meaning | Context |
|------|---------|---------|
| PSR | Pipeline Status Report | Weekly sales doc |
| OKR | Objectives & Key Results | Quarterly planning |
| P0/P1/P2 | Priority levels | P0 = drop everything |

## Internal Terms
| Term | Meaning |
|------|---------|
| standup | Daily 9am sync in #engineering |
| the migration | [[Project Phoenix]] database work |
| ship it | Deploy to production |

## Nicknames → Full Names
| Nickname | Person |
|----------|--------|
| Todd | [[Todd Martinez]] |
| T | [[Todd Martinez]] |
| Sarah | [[Sarah Chen]] |

## Project Codenames
| Codename | Project |
|----------|---------|
| Phoenix | [[Project Phoenix]] |
| Horizon | [[Project Horizon]] |
```

### Company Context (`memory/context/company.md`)

```markdown
---
title: Company Context
tags:
  - reference
  - context
---

# Company Context

## Tools & Systems
| Tool | Used for | Internal name |
|------|----------|---------------|
| Slack | Communication | — |
| Asana | Engineering tasks | — |
| Salesforce | CRM | "SF" or "the CRM" |

## Teams
| Team | What they do | Key people |
|------|-------------|------------|
| Platform | Infrastructure | [[Sarah Chen|Sarah]] (lead) |
| Finance | Money stuff | [[Todd Martinez|Todd]] (lead) |
| Sales | Revenue | [[Greg Wilson|Greg]] |

## Processes
| Process | What it means |
|---------|---------------|
| Weekly sync | Monday 10am all-hands |
| Ship review | Thursday deploy approval |
```

### CLAUDE.md (Hot Cache)

This stays compact (~50-80 lines per context) for fast loading. Uses wikilinks to point into deeper memory.

**Single-context vault** (one account):

```markdown
# Memory

## Me
[Name], [Role] on [Team]. [One sentence about what I do.]

## People
| Who | Role |
|-----|------|
| **[[Todd Martinez\|Todd]]** | Finance lead |
| **[[Sarah Chen\|Sarah]]** | Engineering (Platform) |
| **[[Greg Wilson\|Greg]]** | Sales |
→ Full list: [[Glossary]], profiles: memory/people/

## Terms
| Term | Meaning |
|------|---------|
| PSR | Pipeline Status Report |
| P0 | Drop everything priority |
| standup | Daily 9am sync |
→ Full glossary: [[Glossary]]

## Projects
| Name | What |
|------|------|
| **[[Project Phoenix\|Phoenix]]** | DB migration, Q2 launch |
| **[[Project Horizon\|Horizon]]** | Mobile app redesign |
→ Details: memory/projects/

## Preferences
- 25-min meetings with buffers
- Async-first, Slack over email
- No meetings Friday afternoons
```

**Dual-context vault** (work + personal accounts):

```markdown
# Memory

## Contexts

| Context | Connectors | Description |
|---------|-----------|-------------|
| work | Slack (Acme workspace), Gmail (tony@acme.com), Google Calendar (work) | Work account |
| personal | Gmail (tony@gmail.com), Google Calendar (personal) | Personal account |

## Me
Tony Semana. Work: [Role] at [Company]. Personal: [one line].

## Work — People
| Who | Role |
|-----|------|
| **[[Todd Martinez\|Todd]]** | Finance lead |
| **[[Sarah Chen\|Sarah]]** | Engineering (Platform) |
→ Full list: [[Glossary]], profiles: memory/people/

## Work — Terms
| Term | Meaning |
|------|---------|
| PSR | Pipeline Status Report |
| P0 | Drop everything priority |
→ Full glossary: [[Glossary]]

## Work — Projects
| Name | What |
|------|------|
| **[[Project Phoenix\|Phoenix]]** | DB migration, Q2 launch |
→ Details: memory/projects/

## Personal — People
| Who | Role |
|-----|------|
| **[[Jamie Lee\|Jamie]]** | Contractor (home reno) |
| **[[Dr. Sarah Patel\|Dr. Patel]]** | Dentist |
→ Profiles: memory/people/

## Personal — Projects
| Name | What |
|------|------|
| **[[Kitchen Renovation\|Kitchen reno]]** | Started Jan, budget $45k |
| **[[Europe Trip 2026]]** | Planning for August |
→ Details: memory/projects/

## Preferences
- 25-min meetings with buffers (work)
- Async-first, Slack over email (work)
- No meetings Friday afternoons (work)
```

The `## Contexts` table is what triggers dual-context behavior. Without it, the vault operates in single-context mode.

## Lookup Flow

```
User: "ask todd about the PSR for phoenix"

1. Check CLAUDE.md (hot cache)
   → Todd? ✓ Todd Martinez, Finance
   → PSR? ✓ Pipeline Status Report
   → Phoenix? ✓ DB migration project

2. If not found → search memory/glossary.md
   → Full glossary has everyone/everything

3. If still not found → ask user
   → "What does X mean? I'll remember it."
```

This tiered approach keeps CLAUDE.md lean (~100 lines) while supporting unlimited scale in memory/.

## How to Interact

### Decoding User Input (Tiered Lookup)

**Always** decode shorthand before acting on requests:

```
1. CLAUDE.md (hot cache)     → Check first, covers 90% of cases
2. memory/glossary.md        → Full glossary if not in hot cache
3. memory/people/, projects/ → Rich detail when needed
4. Ask user                  → Unknown term? Learn it.
```

### Adding Memory

When user says "remember this" or "X means Y":

1. **Glossary items** (acronyms, terms, shorthand):
   - Add to memory/glossary.md
   - If frequently used, add to CLAUDE.md Quick Glossary

2. **People:**
   - Create/update memory/people/{name}.md with frontmatter including `aliases`
   - Add `tags: [person]` and role/team properties
   - Use `[[wikilinks]]` for relationships (reports-to, works-with)
   - Add to CLAUDE.md Key People if important
   - **Capture nicknames as aliases** — critical for wikilink resolution

3. **Projects:**
   - Create/update memory/projects/{name}.md with frontmatter including `aliases`
   - Add `tags: [project]` and status/timeline properties
   - Link key people with `[[wikilinks]]`
   - Add to CLAUDE.md Active Projects if current
   - **Capture codenames as aliases** — "Phoenix", "the migration", etc.

4. **Preferences:** Add to CLAUDE.md Preferences section

### Recalling Memory

When user asks "who is X" or "what does X mean":

1. Check CLAUDE.md first
2. Check memory/ for full detail
3. If not found: "I don't know what X means yet. Can you tell me?"

### Progressive Disclosure

1. Load CLAUDE.md for quick parsing of any request
2. Dive into memory/ when you need full context for execution
3. Example: drafting an email to todd about the PSR
   - CLAUDE.md tells you Todd = Todd Martinez, PSR = Pipeline Status Report
   - memory/people/todd-martinez.md tells you he prefers Slack, is direct

## Conventions

- **Bold** terms in CLAUDE.md for scannability
- Keep CLAUDE.md under ~100 lines per context (the "hot 30" rule)
- Filenames: lowercase, hyphens (`todd-martinez.md`, `project-phoenix.md`)
- Always capture nicknames and alternate names **as frontmatter aliases**
- Use `[[wikilinks]]` for all internal references (people, projects, notes)
- Use `[[Display Name|alias]]` syntax when the display differs from the filename
- Add `tags` in frontmatter for all memory notes (person, project, reference, context)
- **Dual-context vaults:** add `context: work` or `context: personal` to frontmatter of every new file
- **Dual-context vaults:** if a person or project belongs to both contexts, use `context: [work, personal]`
- Glossary tables for easy lookup
- When something's used frequently, promote it to CLAUDE.md
- When something goes stale, demote it to memory/ only

## What Goes Where

| Type | CLAUDE.md (Hot Cache) | memory/ (Full Storage) |
|------|----------------------|------------------------|
| Person | Top ~30 frequent contacts | glossary.md + people/{name}.md |
| Acronym/term | ~30 most common | glossary.md (complete list) |
| Project | Active projects only | glossary.md + projects/{name}.md |
| Nickname | In Key People if top 30 | glossary.md (all nicknames) + aliases in frontmatter |
| Company context | Quick reference only | context/company.md |
| Preferences | All preferences | — |
| Historical/stale | ✗ Remove | ✓ Keep in memory/ |

## Promotion / Demotion

**Promote to CLAUDE.md when:**
- You use a term/person frequently
- It's part of active work

**Demote to memory/ only when:**
- Project completed (update status property to "completed")
- Person no longer frequent contact
- Term rarely used

This keeps CLAUDE.md fresh and relevant.
