---
description: Manage Google account connections — list, add, remove, re-authorize, sync
---

# Accounts Command

Manage Google account OAuth connections for calendar and email syncing.

## Instructions

### 1. Show Current State

Call `account_list` to see all registered accounts.

If accounts exist, present as a table:

| Account | Email | Context | OAuth Token | Last Synced |
|---------|-------|---------|-------------|-------------|

If no accounts are registered, tell the user and ask if they'd like to set up their first account.

### 2. Ask What To Do

Present the available actions:

- **Add** — register a new Google account (`account_register`)
- **Remove** — delete an account and its cached data (`account_remove`)
- **Re-authorize** — refresh OAuth token for an existing account (`account_register` with same id)
- **Sync** — sync calendar and email for all accounts (`account_sync`)

### 3. Execute

Based on the user's choice:

**Add:** Ask for:
- `id` — short label (e.g., "work", "personal")
- `email` — Google account email
- `context` — "work" or "personal" (optional)

Then call `account_register`. The user's browser will open for OAuth consent. Wait for them to confirm they completed it.

**Remove:** Confirm with the user first ("This will delete the account and all cached calendar events and emails. Proceed?"), then call `account_remove`.

**Re-authorize:** Call `account_register` with the existing account's id and email. This updates the refresh token in place.

**Sync:** Call `account_sync` with no arguments to sync all accounts. Report results.

### 4. First-Time Setup

If `account_list` returns no accounts AND `account_register` fails with an OAuth configuration error, the user needs to set up prerequisites first. Reference the `account-setup` skill for the full prerequisite walkthrough (Google Cloud project, APIs, OAuth client, 1Password, `.env.schema`).
