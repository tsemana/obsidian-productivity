---
description: GTD Weekly Review — structured 7-step walkthrough
---

# Review Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Conduct a structured GTD Weekly Review. This walks through 7 steps interactively, using `weekly_review` for data and existing atomic tools for mutations.

## Instructions

### 1. Gather Data

Call the `weekly_review` composite tool (single call, returns all data).

If `weekly_review` is not available, inform the user: "The /review command requires the SQLite index (v0.8.0+). Run /start to initialize."

### 2. Walk Through 7 Steps

Present each step's data, ask for batch decisions, and execute changes. Move through steps at a pace the user is comfortable with — don't rush. For each step, summarize the items, then ask for decisions.

**Step 1: Process Inbox**

List each item from `inbox.items`:
```
📥 Inbox (N items)

1. [idea] "Talk to Sarah about budget timeline" — captured Mar 28
2. [unknown] "Check if Horizon API docs are updated" — captured Mar 27
3. [reference] "Article on OKR frameworks" — captured Mar 26

For each: Task (T), Reference (R), or Trash (X)?
```

Execute decisions:
- **Task:** Call `task_create` with the thought as title. Ask for priority/project if not obvious.
- **Reference:** Call `note_move` to move from `inbox/` to `references/`.
- **Trash:** Delete the file with `note_write` (overwrite with empty) or inform user to delete.

**Step 2: Review Active Tasks**

List active tasks grouped by priority:
```
✅ Active Tasks (N items)

High Priority:
- Review budget proposal — due Mar 25 (overdue!)
- Draft Q2 roadmap — due Apr 3

Medium Priority:
- Update team wiki — no due date
- Research CI/CD options — due Apr 10

Still active? Done? Blocked? Reschedule?
```

Execute: `task_update` for status/due changes, `task_complete` for done items.

**Step 3: Review Waiting-Fors**

List waiting tasks with days waiting:
```
⏳ Waiting For (N items)

- Cost estimate from Todd — 14 days ⚠️
  📅 1:1 with Todd in 2 days — follow up?
- API docs from Priya — 3 days
- Feedback on proposal from Sarah — 7 days

Follow up? Convert to active? Drop?
```

Execute: `task_update` for status changes.

**Step 4: Review Projects**

List active projects with task counts. Flag stuck projects:
```
📂 Projects (N active)

● Phoenix — 3 active, 1 waiting, last activity: Mar 28
● Horizon — 0 active, 2 waiting ⚠️ STUCK — no next actions
● Q2 Planning — 5 active, 0 waiting, last activity: Mar 29

Define next actions for stuck projects? Mark any inactive?
```

Execute: `task_create` for new next actions, `note_write` for project status updates.

**Step 5: Review Someday/Maybe**

List someday tasks:
```
💭 Someday/Maybe (N items)

- Learn Rust basics
- Set up home automation
- Write blog post about GTD

Activate? Delete? Keep?
```

Execute: `task_update` (activate) or `task_complete` (delete).

**Step 6: Review Calendar**

Show upcoming 2 weeks:
```
📅 Calendar — Next 2 Weeks

Mon Mar 30: Weekly sync, 1:1 with Sarah
Tue Mar 31: Sprint planning
Wed Apr 1: All-hands, dentist (personal)
...

Any prep needed? Any commitments to capture?
```

Show past week:
```
📅 Last Week — Uncaptured Commitments?

Mon Mar 24: Budget review meeting
Tue Mar 25: Phoenix standup
...

Did any of these create tasks you haven't captured?
```

Execute: `task_create` or `quick_capture` as needed.

**Step 7: Review Memory**

Show reference frequency from `memory.reference_frequency`:
```
🧠 Memory — Top Referenced

1. sarah-chen (12 refs) — in CLAUDE.md ✓
2. project-phoenix (9 refs) — in CLAUDE.md ✓
3. todd-martinez (7 refs) — NOT in CLAUDE.md ← promote?
4. horizon-api (5 refs) — NOT in CLAUDE.md ← promote?
...

15. old-vendor (in CLAUDE.md, 0 refs) ← demote?

Promote or demote any items in CLAUDE.md?
```

Execute: `claudemd_update` for promotions/demotions.

### 3. Generate Review Summary

After all steps, create `reviews/YYYY-MM-DD-review.md`:

```markdown
---
title: Weekly Review — YYYY-MM-DD
tags: [review]
date: YYYY-MM-DD
---

# Weekly Review — YYYY-MM-DD

## Summary
- Inbox: N processed (N→task, N→reference, N→trash)
- Active tasks: N reviewed (N done, N rescheduled, N unchanged)
- Waiting: N reviewed (N followed up, N converted)
- Projects: N reviewed (N stuck projects addressed)
- Someday: N reviewed (N activated, N removed)
- Calendar: N items checked
- Memory: N promotions, N demotions

## Decisions Made
[List key decisions from each step]

## Next Week Focus
[Top 3-5 priorities based on the review]
```

Use `note_write` to create the file. Ensure the `reviews/` directory exists (create with `vault_init` if needed).

## Notes

- One `weekly_review` call provides all data — don't make additional data-fetching calls
- Move through steps at the user's pace — some users want to blitz through, others want to deliberate
- If a step has zero items, briefly note it and move on: "No inbox items — moving to active tasks."
- The review summary participates in the vault link graph — use wikilinks for people and projects
