---
name: account-setup
description: >
  Multi-account Google OAuth setup and management for calendar and email syncing.
  Use when the user asks about Google account setup, calendar/email integration,
  OAuth, managing accounts, or when radar_data returns sources_available with
  calendar: false or email: false. Also triggers when account_sync fails with
  auth errors, or during /start when setting up external accounts.
---

# Account Setup & Management

Manage Google account OAuth connections for calendar and email syncing. This plugin supports **multiple Google accounts** (work, personal, etc.) with locally stored OAuth2 refresh tokens.

## Important: Plugin Tools vs claude.ai Connectors

Do NOT use claude.ai's built-in Gmail or Google Calendar MCP connectors for this. Those are single-account, session-scoped, and tied to whichever Google account the user authorized on claude.ai.

This plugin's account tools (`account_register`, `account_sync`, `account_list`, `account_remove`) use **native OAuth2** with refresh tokens stored locally in SQLite. They support multiple Google accounts simultaneously and work across Claude Code, Cowork, and Claude Desktop.

## Prerequisites (First-Time Only)

Before registering accounts, the user needs OAuth credentials configured. Check if they're already set by calling `account_list` — if it returns accounts with `has_refresh_token: true`, prerequisites are already done.

If OAuth is not configured (account_register returns "OAuth not configured" errors), walk the user through:

1. **Google Cloud project** — create one at https://console.cloud.google.com (or use an existing project)
2. **Enable APIs** — enable "Google Calendar API" and "Gmail API" in the project
3. **OAuth consent screen** — configure as "External" type, add the user's email as a test user
4. **OAuth Client ID** — create credentials of type "Desktop application"
5. **Store in 1Password** — save the client ID and client secret in a 1Password item
6. **Configure `.env.schema`** — edit `plugin/mcp-server/.env.schema` with the correct `op://` paths for the 1Password vault/item. The schema also needs a 1Password Service Account token stored in macOS Keychain (see the `security find-generic-password` reference in the file)

The `.env.schema` is loaded automatically when the MCP server starts — no wrapper command needed.

## Workflow

### Checking Current State

Always start by calling `account_list` to see what's already registered:

```
account_list → shows all accounts, token status, last sync time
```

Present results as a table to the user.

### Adding an Account

For each Google account the user wants to connect:

```
account_register(id: "personal", email: "user@gmail.com", context: "personal")
```

- `id` — short label the user chooses (e.g., "work", "personal", "consulting")
- `email` — the Google account email address
- `context` — optional, typically "work" or "personal"

This opens the user's browser to Google's OAuth consent screen. After they approve, the refresh token is stored locally. Wait for the user to confirm they completed the browser flow.

### Verifying

After registering accounts, verify they work:

```
account_sync → syncs all registered accounts
```

Check results: each account should show `calendar_events_synced > 0` and/or `emails_synced > 0`.

Then confirm end-to-end:

```
radar_data → should show sources_available.calendar: true, sources_available.email: true
```

### Removing an Account

```
account_remove(id: "work") → deletes account + all cached calendar events and emails
```

Always confirm with the user before removing. The data is just a cache — they can re-register to get it back.

### Re-authorizing an Account

If a token expires or gets revoked, re-run `account_register` with the same `id`. It updates the refresh token in place without creating a duplicate.

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "No refresh token received" | Account was previously authorized without revoking | Go to https://myaccount.google.com/permissions, remove the app, try `account_register` again |
| "OAuth not configured" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` not in environment | Check `.env.schema` in `plugin/mcp-server/` — verify `op://` paths and Keychain entry |
| "OAuth authorization timed out" | Browser flow not completed within 120 seconds | Run `account_register` again |
| "Refresh token has been revoked" | User revoked app access or Google revoked it | Run `account_register` again with the same id to re-authorize |
| Calendar events missing | Calendar API not enabled in Google Cloud project | Enable "Google Calendar API" at https://console.cloud.google.com/apis |
| Gmail empty | Gmail API not enabled, or no matching emails | Enable "Gmail API"; note default query is `is:unread (is:important OR is:starred)` |
| "auth_failed" with gcloud | OAuth not configured and gcloud CLI not authenticated | Configure OAuth (preferred) or run `gcloud auth login <email>` |
