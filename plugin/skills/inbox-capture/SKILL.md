---
name: inbox-capture
description: >
  Two-speed thought capture: AI-assisted (instant task) or deferred (inbox note).
  Uses quick_capture MCP tool. Trigger when user says "capture this", "remind me",
  "inbox", "just note that", "save this thought", "I need to remember", "quick note",
  or shares a thought that needs to be persisted.
---

# Inbox Capture

Capture thoughts with minimal friction using the two-speed model.

## When to Use

Trigger this skill when the user shares a thought that needs to be persisted — whether it's a clear task or a vague idea. Also trigger during `/review` inbox processing.

**Trigger phrases:** "capture this", "remind me", "inbox this", "just note that", "save this thought", "I need to remember", "quick note", "add to my list", "don't let me forget".

## Two-Speed Capture Model

### Speed 1: AI-Assisted (Fast Clarify)

**When:** The user's intent is clear — you can interpret the shorthand, identify the project/person, and determine it's a task.

**Action:** Call `quick_capture` with `hint: "task"`. This creates a full task note in `tasks/` with proper frontmatter (title, status, priority, created). The inbox is skipped entirely.

**Example:**
```
User: "remind me to send the PSR to Todd by Friday"

→ quick_capture({ thought: "Send PSR to Todd", hint: "task" })
→ Creates tasks/send-psr-to-todd.md with due: Friday, project/person wikilinks
```

After capturing, if `suggested_links` are returned, mention them: "Created task. Related notes: [[todd-martinez]], [[project-phoenix]]."

### Speed 2: Deferred (Raw Capture)

**When:** The thought is ambiguous, the user explicitly says "just capture this" or "inbox this", or you're unsure whether it's a task, reference, or idea.

**Action:** Call `quick_capture` with `hint: "idea"`, `"reference"`, or `"unknown"`. This creates a timestamped note in `inbox/` for later processing during `/review`.

**Example:**
```
User: "something about the API rate limits being wrong"

→ quick_capture({ thought: "API rate limits might be wrong", hint: "idea" })
→ Creates inbox/2026-03-30T14-22-00-api-rate-limits-might-be-wrong.md
```

### Decision Guide

| Signal | Speed | Hint |
|--------|-------|------|
| User says "task", "todo", "need to", "should" | 1 | task |
| Clear action with a deadline or person | 1 | task |
| User says "inbox", "capture", "just note" | 2 | idea/unknown |
| Vague thought, no clear action | 2 | idea |
| URL, article, resource to save | 2 | reference |
| You're unsure | 2 | unknown |

## During /review Inbox Processing

When the `/review` command processes inbox items (Step 1), this skill guides the classification:

For each inbox item:
1. Read the full note content
2. Propose a classification:
   - **Task:** Suggest title, priority, project, person wikilinks
   - **Reference:** Suggest target directory (`references/` or a subdirectory)
   - **Trash:** Explain why it's no longer relevant
3. Wait for user approval before executing

Execute on approval:
- **Task:** `task_create` with the decoded details, then delete the inbox note
- **Reference:** `note_move` from `inbox/` to `references/`
- **Trash:** Delete the inbox note

## Notes

- `quick_capture` requires the SQLite index (v0.8.0+). If not available, fall back to `task_create` (for tasks) or `note_write` (for inbox items) directly.
- Always confirm the capture: "Captured: [title] → [location]"
- If `suggested_links` are returned, mention them to help the user build connections
- Don't over-classify — when in doubt, use Speed 2. The `/review` walkthrough handles deferred items properly.
