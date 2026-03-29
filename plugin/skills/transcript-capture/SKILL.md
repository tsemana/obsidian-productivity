---
name: transcript-capture
description: >
  Processes a meeting transcript, call recording, presentation, or document into structured Obsidian vault notes: a distilled reference note in memory/, active task notes for the user's own action items, and waiting-for notes for dependencies on others. Use this skill whenever the user shares a document, transcript, or URL and wants it captured in their vault — trigger on phrases like "review this transcript", "save tasks from this call", "distill this doc into notes", "extract action items from this meeting", "save notes from this call", "add this to my vault", or any time a document link is shared alongside language about capturing, reviewing, or extracting. Also trigger when the user says things like "turn this into reference" or "what do I need to do from this?"
---

# Transcript Capture

Turn a meeting transcript, call recording, presentation, or any document into structured Obsidian vault notes: a reference note, task notes for your commitments, and waiting-for notes for what you're expecting from others.

## Setup: Read Context Before Writing Anything

Before touching the vault, load context that will shape everything you create:

1. **Read `CLAUDE.md`** at the vault root (`/mnt/LifeOS/CLAUDE.md` or wherever the vault lives). This tells you who's who (people, their roles, wikilink slugs), active projects, and key terms. You need this to write wikilinks correctly — `[[gavrilo-belacevic|Gavrilo]]` not `[[Gavrilo]]` — and to recognize people and projects in the transcript.

2. **Fetch the document.** If it's a Google Doc URL, use the Google Drive fetch tool. If it's an uploaded file, read it. If it's pasted text, work from that.

3. **Scan `tasks/`** briefly to find any existing tasks that might overlap with what you're about to create. You want to update existing tasks rather than create near-duplicates.

## Workflow

### Step 1 — Distill a reference note → `memory/<slug>.md`

Create one reference note that captures the durable substance of the document. Organize it by **topic**, not chronology — this is a reference to look things up in, not a meeting recap.

**Frontmatter:**
```yaml
---
title: <Descriptive Title>
date: YYYY-MM-DD
tags:
  - reference
  - <relevant-tag>
aliases:
  - Short Name
---
```

**Structure:**
- Opening sentence: what this document is (meeting type, participants, context)
- `## Source` — link to the originating document, right near the top
- `## <Topic>` sections — one per major subject area, written as structured reference (use tables, bullets, callouts as needed)
- `## People Mentioned` — final section listing who appeared with wikilinks and their role in this context

A good reference note is thorough enough that future-you could look it up and understand what was discussed, what decisions were made, and what the key details are — without re-reading the transcript.

### Step 2 — Create task notes for your own action items → `tasks/<slug>.md`

For each action item you committed to (or was clearly assigned to you), create a separate note.

**Filename:** imperative verb phrase — `chat-with-doug-migration.md`, `add-ia-to-datadog.md`

**Frontmatter:**
```yaml
---
title: <Imperative verb phrase>
tags:
  - task
context: vetsource   # or personal
status: active       # active | someday | waiting
priority: high | medium | low
due: YYYY-MM-DD      # only if explicitly mentioned
created: YYYY-MM-DD
project: "[[ProjectName]]"   # if applicable
---
```

**Body:**
- `#` heading matching the title
- One or two sentences of context (why this matters, where it came from)
- `## Subtasks` — concrete next steps if you can infer them
- `## Source` — link to the originating document
- `## Related` — wikilinks to relevant people, projects, other notes

**Status guidance:**
- `active` — there was an explicit commitment ("I'll do X", "we need to Y")
- `someday` — a good idea was floated without firm commitment; worth tracking but not urgent
- Don't create tasks for things discussed without any action intent

### Step 3 — Create waiting-for notes for others' deliverables → `tasks/wf-<person>-<slug>.md`

For each deliverable, decision, or piece of information you're waiting on from a named person, create a WF note.

**Extra frontmatter fields:**
```yaml
status: waiting
waiting-on: "[[person-slug|Person Name]]"
waiting-since: YYYY-MM-DD
```

**Extra body sections:**
- `## Waiting for` — bullet list, specific: what exactly are you waiting for? (deliverable, decision, date estimate)
- `## Why it matters` — what this unblocks for you

### Step 4 — Cross-link and update existing tasks

Before saving, check whether any existing tasks in `tasks/` are related to what you just created:
- If an existing task covers substantially the same ground, **update it** with a `## Log` entry and new cross-references — don't create a duplicate
- If your new tasks are related to existing ones, add `## Related` links in both directions

### Step 5 — Source link on everything

Every note created or meaningfully updated in this session must have a `## Source` section with a link to the originating document. This is the paper trail that lets you find the original context months later.

## Naming Conventions

| Type | Pattern | Examples |
|------|---------|---------|
| Reference note | subject slug | `ia-tech-review-s7p2.md`, `fivetran-renewal-call.md` |
| Task note | imperative verb phrase | `chat-with-doug-migration.md`, `add-ia-to-datadog.md` |
| Waiting-for note | `wf-<person>-<subject>.md` | `wf-gavrilo-iguazio-savings.md` |

## Wikilinks

Use the exact slug format from CLAUDE.md. Most people: `[[slug|Display Name]]`

```
✓  [[gavrilo-belacevic|Gavrilo]]
✓  [[will-de-la-guardia|Will]]
✓  [[Iguazio Sunset]]
✗  [[Gavrilo]]
✗  [[Will de la Guardia]]
```

If someone appears in the transcript but isn't in CLAUDE.md yet, use their full name as plain text rather than a broken wikilink.

## What to Include vs. Skip

**Include:**
- Explicit commitments and assigned action items
- Named waiting-fors (person X owes you Y)
- Key reference facts worth looking up later: costs, vendors, timelines, decisions made, technical details
- Enough people/context to follow up effectively

**Skip:**
- General background knowledge that doesn't need to be looked up
- Tangents with no action or reference value
- Things already well-covered in CLAUDE.md

## Callouts (use sparingly)

For important flags in the reference note:

```markdown
> [!warning] Risk or concern title
> Brief description of the concern.

> [!note] Follow-up
> Cross-reference to task: [[task-slug]]
```
