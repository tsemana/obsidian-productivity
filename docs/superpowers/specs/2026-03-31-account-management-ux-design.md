# SP4: Account Management UX — Design Spec

**Goal:** Make multi-account Google OAuth setup discoverable, self-service, and robust for new and existing vaults. Claude should never confuse the plugin's native multi-account OAuth with claude.ai's built-in single-account Gmail/Calendar connectors.

**Motivation:** Users attempting to set up multi-account calendar/email integration hit friction because:
1. `account_register` tool description still references gcloud CLI, misleading Claude
2. No skill teaches Claude the OAuth2 workflow or when to use it
3. No way to list or remove registered accounts
4. No direct user-facing command for account management
5. Claude conflates the plugin's tools with claude.ai's built-in Gmail/Calendar MCP connectors

---

## 1. New MCP Tools

### 1.1 `account_list`

Returns all registered Google accounts with status info.

**Parameters:** None.

**Returns:**
```json
{
  "accounts": [
    {
      "id": "personal",
      "email": "tony.semana@gmail.com",
      "context": "personal",
      "has_refresh_token": true,
      "last_synced_at": "2026-03-31T10:15:00Z"
    }
  ],
  "total": 1
}
```

**Tool description:** `"List all registered Google accounts with their sync status and OAuth token state."`

**Implementation:** Single SELECT on `external_accounts`. Format `last_synced_at` as ISO string, or `null` if the account has never been synced. Derive `has_refresh_token` as boolean from `refresh_token IS NOT NULL`. Returns empty array if no accounts are registered.

### 1.2 `account_remove`

Removes an account and all its cached data.

**Parameters:**
- `id` (string, required) — account label to remove

**Returns:**
```json
{
  "id": "personal",
  "email": "tony.semana@gmail.com",
  "removed": {
    "calendar_events": 47,
    "emails": 12
  },
  "message": "Account \"personal\" (tony.semana@gmail.com) and all cached data removed."
}
```

**Error case:** Account not found returns `{ "error": "not_found", "message": "Account \"xyz\" not found." }`

**Tool description:** `"Remove a registered Google account and delete all its cached calendar events and emails."`

**Implementation:** Count rows in `calendar_events` and `email_cache` for the account, then DELETE from all three tables (`calendar_events`, `email_cache`, `external_accounts`) in a transaction.

---

## 2. Updated Tool Descriptions

### 2.1 `account_register`

**Current:** `"Register a Google account for calendar and email syncing. Requires gcloud CLI authentication."`

**New:** `"Register a Google account via OAuth2 browser flow for calendar and email syncing. Supports multiple accounts (work, personal, etc). Re-run on an existing account to re-authorize. Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET via Varlock."`

### 2.2 `account_sync`

**Current:** `"Sync calendar events and email from registered Google accounts into the local cache."`

**New:** `"Sync calendar events and emails from registered Google accounts into the local cache. Uses stored OAuth2 refresh tokens. Omit id to sync all accounts."`

---

## 3. Skill: `account-setup`

**Location:** `plugin/skills/account-setup/SKILL.md`

**Trigger conditions:** User asks about Google account setup, calendar/email integration, OAuth, account management, or when `radar_data` returns `sources_available.calendar: false` or `sources_available.email: false`.

**Skill content structure:**

### Prerequisites Section
Brief checklist for first-time setup:
1. Create a Google Cloud project with OAuth consent screen (Desktop app type)
2. Enable Calendar API and Gmail API
3. Create OAuth 2.0 Client ID (Desktop application)
4. Store `client-id` and `client-secret` in 1Password at `op://LifeOS/google-oauth/`
5. Verify Varlock resolves: `cd plugin/mcp-server && varlock load`

Note: The `.env.schema` in the MCP server defines the 1Password references. Users with different 1Password vault names need to edit the `op://` paths.

### Important Distinction Section
Clarify that:
- **claude.ai Gmail / Google Calendar** = built-in MCP connectors, single account per session, tied to whichever Google account you authorized on claude.ai
- **This plugin's `account_register` / `account_sync`** = native OAuth2, multiple accounts, refresh tokens stored locally in SQLite, works in Claude Code, Cowork, and Claude Desktop

If the user wants multi-account access, use the plugin tools. The built-in connectors are irrelevant.

### Workflow Section
Standard flow Claude should follow:

1. **Check current state:** Call `account_list` to see what's already registered
2. **Add accounts:** Call `account_register` for each Google account — browser opens, user consents, refresh token stored
3. **Verify:** Call `account_sync` (no id = sync all) to confirm tokens work
4. **Test:** Call `radar_data` to verify `sources_available` shows `calendar: true, email: true`

### Re-authorization Section
When to re-authorize:
- Token refresh fails with "invalid_grant" → user revoked access or token expired
- User wants to change scopes
- Fix: Run `account_register` again with the same id — it updates the refresh token in place

### Removal Section
- Call `account_remove` with the account id
- Deletes account + all cached calendar events and emails
- User can re-register the same id later

### Troubleshooting Section
Common issues:
- **"No refresh token received"** → Account was previously authorized without revoking. Go to https://myaccount.google.com/permissions, remove the app, try again
- **"OAuth not configured"** → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` not in environment. Check Varlock: `varlock load` in `plugin/mcp-server/`
- **"OAuth authorization timed out"** → Browser flow wasn't completed within 120 seconds. Run `account_register` again
- **Calendar events missing** → Check that Calendar API is enabled in the Google Cloud project
- **Gmail empty** → Check that Gmail API is enabled; default query is `is:unread (is:important OR is:starred)`

---

## 4. Command: `/accounts`

**Location:** `plugin/commands/accounts.md`

**Behavior:** Lightweight prompt that tells Claude to:

1. Call `account_list` to show the current state
2. Present results as a table (id, email, context, token status, last synced)
3. Ask the user what they want to do:
   - **Add** an account → walk through `account_register`
   - **Remove** an account → confirm, then `account_remove`
   - **Re-authorize** an existing account → `account_register` with same id
   - **Sync** all accounts → `account_sync`
   - **First-time setup** → walk through prerequisites, then add accounts
4. If no accounts exist and OAuth credentials aren't set, guide through prerequisites first

The command references the `account-setup` skill for detailed workflows.

---

## 5. File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `plugin/mcp-server/src/tools/external.ts` | Modify | Add `accountList()` and `accountRemove()` functions |
| `plugin/mcp-server/src/index.ts` | Modify | Register `account_list` and `account_remove` tools; update descriptions for `account_register` and `account_sync` |
| `plugin/skills/account-setup/SKILL.md` | Create | Skill teaching Claude the multi-account OAuth workflow |
| `plugin/commands/accounts.md` | Create | `/accounts` command for user-facing account management |

---

## 6. Non-Goals

- **Scope changes:** Not adding write access to Calendar or Gmail — read-only stays.
- **Auto-discovery:** Not auto-detecting which Google accounts the user has — they explicitly register each one.
- **Token encryption:** Refresh tokens are stored in plaintext in SQLite (`.vault-index.db` is gitignored and local-only). Encryption is out of scope.
- **Non-Google providers:** The `external_accounts` schema supports a `provider` column, but this spec is Google-only.
