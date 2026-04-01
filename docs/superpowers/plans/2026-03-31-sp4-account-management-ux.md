# SP4: Account Management UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-account Google OAuth setup discoverable, self-service, and robust — with `account_list`, `account_remove` tools, an `account-setup` skill, an `/accounts` command, and direct credential loading (no Varlock runtime).

**Architecture:** Add two new MCP tools (`account_list`, `account_remove`) to `external.ts`. Create `env.ts` to parse `.env.schema` exec() directives at server startup. Update tool descriptions to reference OAuth2 instead of gcloud. Add a skill and command for Claude-guided account management. Remove `varlock` runtime dependency.

**Tech Stack:** TypeScript, better-sqlite3, Node.js `execSync`, MCP SDK

**Spec:** [docs/superpowers/specs/2026-03-31-account-management-ux-design.md](../specs/2026-03-31-account-management-ux-design.md)

**Note:** This project has no test framework configured. Steps use manual verification commands instead of automated tests.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `plugin/mcp-server/src/env.ts` | Create | Parse `.env.schema` exec() directives, load into `process.env` at startup |
| `plugin/mcp-server/src/tools/external.ts` | Modify | Add `accountList()` and `accountRemove()` functions |
| `plugin/mcp-server/src/index.ts` | Modify | Import and call `loadEnvSchema()`, register two new tools, update two tool descriptions, update import |
| `plugin/mcp-server/src/google-api.ts` | Modify | Update Varlock reference in error message |
| `plugin/mcp-server/package.json` | Modify | Remove `varlock` dependency |
| `plugin/skills/account-setup/SKILL.md` | Create | Skill teaching Claude the multi-account OAuth workflow |
| `plugin/commands/accounts.md` | Create | `/accounts` command for user-facing account management |

---

### Task 1: Create env.ts — .env.schema Loader

**Files:**
- Create: `plugin/mcp-server/src/env.ts`

- [ ] **Step 1: Create the env.ts module**

Create `plugin/mcp-server/src/env.ts`:

```typescript
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse .env.schema and load exec() directives into process.env.
 * Silently skips lines that fail — credentials become optional
 * (gcloud fallback still works).
 */
export function loadEnvSchema(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // .env.schema lives in the package root, one level up from src/
  const schemaPath = join(__dirname, "..", ".env.schema");

  let content: string;
  try {
    content = readFileSync(schemaPath, "utf-8");
  } catch {
    // No .env.schema found — not an error, credentials just won't be auto-loaded
    return;
  }

  const execPattern = /^([A-Z_]+)=exec\(`(.+)`\)\s*$/;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Skip if already set in environment (explicit env vars take precedence)
    const match = trimmed.match(execPattern);
    if (!match) continue;

    const [, key, command] = match;
    if (process.env[key]) continue;

    try {
      const value = execSync(command, {
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (value) {
        process.env[key] = value;
      }
    } catch {
      // Silent skip — log to stderr for debugging
      console.error(`env.ts: Failed to resolve ${key} from .env.schema (continuing without it)`);
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/env.ts
git commit -m "feat: add env.ts — load .env.schema exec() directives at startup"
```

---

### Task 2: Wire loadEnvSchema into Server Startup and Remove Varlock

**Files:**
- Modify: `plugin/mcp-server/src/index.ts:1-28`
- Modify: `plugin/mcp-server/package.json`

- [ ] **Step 1: Add loadEnvSchema import and call in index.ts**

In `plugin/mcp-server/src/index.ts`, add the import after the existing imports (after line 20):

```typescript
import { loadEnvSchema } from "./env.js";
```

Then add the call before the vault path resolution (before line 28, `const vaultPath = resolveVaultPath();`):

```typescript
// Load OAuth credentials from .env.schema (exec() directives → process.env)
loadEnvSchema();
```

- [ ] **Step 2: Remove varlock from package.json**

In `plugin/mcp-server/package.json`, remove the `"varlock": "^0.6.4"` line from dependencies.

- [ ] **Step 3: Rebuild and verify**

```bash
cd plugin/mcp-server && npm install && npm run build
```

Expected: Clean compilation. `varlock` no longer in `node_modules` (or at least not a direct dependency).

- [ ] **Step 4: Verify credentials load**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | OBSIDIAN_VAULT_PATH="$HOME/LifeOS" timeout 5 node dist/index.js 2>&1 | grep -i "env\|client"
```

Expected: stderr shows no "Failed to resolve" errors (meaning GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET loaded successfully).

- [ ] **Step 5: Commit**

```bash
git add plugin/mcp-server/src/index.ts plugin/mcp-server/package.json plugin/mcp-server/package-lock.json
git commit -m "feat: load .env.schema at startup, remove varlock runtime dependency"
```

---

### Task 3: Add accountList and accountRemove Functions

**Files:**
- Modify: `plugin/mcp-server/src/tools/external.ts`

- [ ] **Step 1: Add accountList function**

Add the following function at the end of `plugin/mcp-server/src/tools/external.ts` (after the `accountSync` function):

```typescript
/** account_list — list all registered Google accounts with status */
export function accountList(
  db: DatabaseType,
): {
  accounts: Array<{
    id: string;
    email: string;
    context: string | null;
    has_refresh_token: boolean;
    last_synced_at: string | null;
  }>;
  total: number;
} {
  const rows = db
    .prepare(
      "SELECT id, account_email, context, refresh_token, last_synced_at FROM external_accounts",
    )
    .all() as Array<{
    id: string;
    account_email: string;
    context: string | null;
    refresh_token: string | null;
    last_synced_at: number | null;
  }>;

  const accounts = rows.map((row) => ({
    id: row.id,
    email: row.account_email,
    context: row.context,
    has_refresh_token: row.refresh_token !== null,
    last_synced_at: row.last_synced_at
      ? new Date(row.last_synced_at).toISOString()
      : null,
  }));

  return { accounts, total: accounts.length };
}
```

- [ ] **Step 2: Add accountRemove function**

Add the following function after `accountList`:

```typescript
/** account_remove — remove an account and all its cached data */
export function accountRemove(
  db: DatabaseType,
  options: { id: string },
): { id: string; email: string; removed: { calendar_events: number; emails: number }; message: string } | { error: string; message: string } {
  const { id } = options;

  const account = db
    .prepare("SELECT id, account_email FROM external_accounts WHERE id = ?")
    .get(id) as { id: string; account_email: string } | undefined;

  if (!account) {
    return { error: "not_found", message: `Account "${id}" not found.` };
  }

  const calendarCount = (
    db.prepare("SELECT COUNT(*) as count FROM calendar_events WHERE account_id = ?").get(id) as { count: number }
  ).count;

  const emailCount = (
    db.prepare("SELECT COUNT(*) as count FROM email_cache WHERE account_id = ?").get(id) as { count: number }
  ).count;

  const remove = db.transaction(() => {
    db.prepare("DELETE FROM calendar_events WHERE account_id = ?").run(id);
    db.prepare("DELETE FROM email_cache WHERE account_id = ?").run(id);
    db.prepare("DELETE FROM external_accounts WHERE id = ?").run(id);
  });
  remove();

  return {
    id,
    email: account.account_email,
    removed: { calendar_events: calendarCount, emails: emailCount },
    message: `Account "${id}" (${account.account_email}) and all cached data removed.`,
  };
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/src/tools/external.ts
git commit -m "feat: add accountList and accountRemove functions"
```

---

### Task 4: Register New Tools and Update Descriptions in index.ts

**Files:**
- Modify: `plugin/mcp-server/src/index.ts:18` (import)
- Modify: `plugin/mcp-server/src/index.ts:406-434` (tool registrations)

- [ ] **Step 1: Update the import from external.ts**

In `plugin/mcp-server/src/index.ts`, change line 18:

From:
```typescript
import { accountRegister, accountSync } from "./tools/external.js";
```

To:
```typescript
import { accountRegister, accountSync, accountList, accountRemove } from "./tools/external.js";
```

- [ ] **Step 2: Update account_register tool description**

In `plugin/mcp-server/src/index.ts`, change the `account_register` tool description (line 410):

From:
```typescript
  "Register a Google account for calendar and email syncing. Requires gcloud CLI authentication.",
```

To:
```typescript
  "Register a Google account via OAuth2 browser flow for calendar and email syncing. Supports multiple accounts (work, personal, etc). Re-run on an existing account to re-authorize. OAuth credentials are auto-loaded from .env.schema on startup.",
```

- [ ] **Step 3: Update account_sync tool description**

In `plugin/mcp-server/src/index.ts`, change the `account_sync` tool description (line 424):

From:
```typescript
  "Sync calendar events and email from registered Google accounts into the local cache.",
```

To:
```typescript
  "Sync calendar events and emails from registered Google accounts into the local cache. Uses stored OAuth2 refresh tokens. Omit id to sync all accounts.",
```

- [ ] **Step 4: Add account_list tool registration**

In `plugin/mcp-server/src/index.ts`, add the following after the `account_sync` tool registration (after line 434, before the `// ─── Group 9: Radar` comment):

```typescript
server.tool(
  "account_list",
  "List all registered Google accounts with their sync status and OAuth token state.",
  {},
  async () => {
    if (!db) return { content: [{ type: "text", text: JSON.stringify({ error: "no_database", message: "SQLite not initialized" }) }] };
    return { content: [{ type: "text", text: JSON.stringify(accountList(db), null, 2) }] };
  },
);

server.tool(
  "account_remove",
  "Remove a registered Google account and delete all its cached calendar events and emails.",
  {
    id: z.string().describe("Account id to remove, e.g. 'work' or 'personal'"),
  },
  async ({ id }) => {
    if (!db) return { content: [{ type: "text", text: JSON.stringify({ error: "no_database", message: "SQLite not initialized" }) }] };
    return { content: [{ type: "text", text: JSON.stringify(accountRemove(db, { id }), null, 2) }] };
  },
);
```

- [ ] **Step 5: Verify it compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation.

- [ ] **Step 6: Verify tools are registered**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | OBSIDIAN_VAULT_PATH="$HOME/LifeOS" timeout 5 node dist/index.js 2>/dev/null | python3 -c "import sys,json; tools=[t['name'] for t in json.load(sys.stdin)['result']['tools']]; [print(t) for t in tools if 'account' in t]"
```

Expected output:
```
account_register
account_sync
account_list
account_remove
```

- [ ] **Step 7: Commit**

```bash
git add plugin/mcp-server/src/index.ts
git commit -m "feat: register account_list and account_remove tools, update descriptions"
```

---

### Task 5: Update Varlock References in Error Messages

**Files:**
- Modify: `plugin/mcp-server/src/google-api.ts:49-52`
- Modify: `plugin/mcp-server/src/tools/external.ts:54`

- [ ] **Step 1: Update error message in google-api.ts**

In `plugin/mcp-server/src/google-api.ts`, change lines 50-52:

From:
```typescript
      `Either configure OAuth (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET via Varlock) ` +
      `or run: gcloud auth login ${account.account_email}\n${e}`,
```

To:
```typescript
      `Either configure OAuth credentials in .env.schema (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET) ` +
      `or run: gcloud auth login ${account.account_email}\n${e}`,
```

- [ ] **Step 2: Update error message in external.ts**

In `plugin/mcp-server/src/tools/external.ts`, change line 54:

From:
```typescript
        message: `Cannot authenticate ${email}. Either configure OAuth (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET via Varlock) or run: gcloud auth login ${email}\n${e}`,
```

To:
```typescript
        message: `Cannot authenticate ${email}. Either configure OAuth credentials in .env.schema (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET) or run: gcloud auth login ${email}\n${e}`,
```

- [ ] **Step 3: Verify it compiles**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/src/google-api.ts plugin/mcp-server/src/tools/external.ts
git commit -m "fix: replace Varlock references with .env.schema in error messages"
```

---

### Task 6: Create account-setup Skill

**Files:**
- Create: `plugin/skills/account-setup/SKILL.md`

- [ ] **Step 1: Create the skill directory and file**

Create `plugin/skills/account-setup/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Verify skill is well-formed**

```bash
head -8 plugin/skills/account-setup/SKILL.md
```

Expected: YAML frontmatter with `name:` and `description:` fields.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/account-setup/SKILL.md
git commit -m "feat: add account-setup skill for multi-account OAuth guidance"
```

---

### Task 7: Create /accounts Command

**Files:**
- Create: `plugin/commands/accounts.md`

- [ ] **Step 1: Create the command file**

Create `plugin/commands/accounts.md`:

```markdown
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
```

- [ ] **Step 2: Verify command is well-formed**

```bash
head -4 plugin/commands/accounts.md
```

Expected: YAML frontmatter with `description:` field.

- [ ] **Step 3: Commit**

```bash
git add plugin/commands/accounts.md
git commit -m "feat: add /accounts command for account management"
```

---

### Task 8: Rebuild dist/ and End-to-End Verification

**Files:**
- Modify: `plugin/mcp-server/dist/` (rebuild)

- [ ] **Step 1: Rebuild**

```bash
cd plugin/mcp-server && npm run build
```

Expected: Clean compilation.

- [ ] **Step 2: Verify account_list works**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"account_list","arguments":{}}}' | OBSIDIAN_VAULT_PATH="$HOME/LifeOS" timeout 5 node dist/index.js 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin); print(json.dumps(json.loads(r['result']['content'][0]['text']),indent=2))"
```

Expected: JSON with `accounts` array listing registered accounts with `has_refresh_token` and `last_synced_at` fields.

- [ ] **Step 3: Verify account_remove works (on a test account)**

Only run this if you have a test/throwaway account registered. Skip if all accounts are production.

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"account_remove","arguments":{"id":"test"}}}' | OBSIDIAN_VAULT_PATH="$HOME/LifeOS" timeout 5 node dist/index.js 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin); print(json.dumps(json.loads(r['result']['content'][0]['text']),indent=2))"
```

Expected: Either success message with removed counts, or `not_found` error (if "test" doesn't exist — which confirms the error path works).

- [ ] **Step 4: Verify credentials loaded without Varlock**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"account_sync","arguments":{"id":"personal"}}}' | OBSIDIAN_VAULT_PATH="$HOME/LifeOS" timeout 10 node dist/index.js 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin); d=json.loads(r['result']['content'][0]['text']); print(d['accounts'][0])"
```

Expected: Successful sync with `calendar_events_synced > 0` — proving OAuth credentials loaded from `.env.schema` without Varlock wrapper.

- [ ] **Step 5: Commit dist/**

```bash
git add plugin/mcp-server/dist/
git commit -m "chore: rebuild dist/ with account management tools"
```

---

### Task 9: Bump Version

**Files:**
- Modify: `plugin/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugin/mcp-server/package.json`

- [ ] **Step 1: Bump version to 0.11.0**

In all three files, change `"version": "0.10.0"` to `"version": "0.11.0"`.

- [ ] **Step 2: Commit**

```bash
git add plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json plugin/mcp-server/package.json
git commit -m "chore: bump version to 0.11.0 for account management UX"
```
