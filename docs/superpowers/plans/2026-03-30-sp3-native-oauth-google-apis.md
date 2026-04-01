# SP3: Native OAuth2 for Google APIs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace gcloud-CLI-based token acquisition with native OAuth2 so the MCP server can access Google Calendar and Gmail APIs with the correct scopes.

**Architecture:** New `google-oauth.ts` module handles the OAuth2 authorization code flow (consent URL, localhost callback server, token exchange, token refresh). `google-api.ts` changes its `getAccessToken` function to use stored refresh tokens instead of gcloud CLI. Schema migration V2 adds a `refresh_token` column. Varlock + 1Password supply the OAuth client credentials.

**Tech Stack:** Node.js `http` (callback server), `open` (launch browser), Varlock + `@varlock/1password-plugin` (credentials), Google OAuth2 REST endpoints, SQLite (refresh token storage)

**Spec:** [docs/superpowers/specs/2026-03-30-sp3-native-oauth-google-apis-design.md](../specs/2026-03-30-sp3-native-oauth-google-apis-design.md)

**Note:** This project has no test framework configured. Steps use manual verification commands instead of automated tests.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `plugin/mcp-server/.env.schema` | Create | Varlock schema defining `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` with `op://` references |
| `plugin/mcp-server/src/google-oauth.ts` | Create | OAuth2 flow: consent URL generation, localhost callback server, code-for-token exchange, token refresh |
| `plugin/mcp-server/src/index-db.ts` | Modify | Migration V2: add `refresh_token` column to `external_accounts` |
| `plugin/mcp-server/src/google-api.ts` | Modify | `getAccessToken` uses refresh tokens (OAuth path) with gcloud fallback; `syncAccount` signature update |
| `plugin/mcp-server/src/tools/external.ts` | Modify | `accountRegister` triggers OAuth browser flow; supports re-registration; `accountSync` signature update |
| `plugin/mcp-server/package.json` | Modify | Add `open` dependency; add `varlock` dependency; update scripts to use `varlock run` |

---

### Task 1: Add Dependencies

**Files:**
- Modify: `plugin/mcp-server/package.json`

- [ ] **Step 1: Install `open` and `varlock` packages**

```bash
cd plugin/mcp-server
npm install open varlock @varlock/1password-plugin
```

This adds:
- `open` — cross-platform browser launcher
- `varlock` — env schema + secret resolution
- `@varlock/1password-plugin` — 1Password `op://` resolver

- [ ] **Step 2: Update npm scripts to use varlock**

In `plugin/mcp-server/package.json`, update the `scripts` section:

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "varlock run -- tsx src/index.ts",
    "start": "varlock run -- node dist/index.js"
  }
}
```

The `varlock run --` prefix resolves `.env.schema` and injects the resolved values into `process.env` before the child process starts.

- [ ] **Step 3: Verify build still compiles**

```bash
npm run build
```

Expected: Clean compilation, no errors.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/package.json plugin/mcp-server/package-lock.json
git commit -m "chore: add open, varlock, 1password-plugin dependencies for OAuth2 flow"
```

---

### Task 2: Create Varlock Schema

**Files:**
- Create: `plugin/mcp-server/.env.schema`

- [ ] **Step 1: Create the `.env.schema` file**

```env
# @plugin(@varlock/1password-plugin)
# @initOp(allowAppAuth=true)
# ---

# Google OAuth2 credentials for Calendar & Gmail API access
# Create a Desktop-type OAuth Client ID at https://console.cloud.google.com
# Replace the op:// references with your own 1Password vault/item paths

# @sensitive
GOOGLE_CLIENT_ID=op(op://LifeOS/google-oauth/client-id)
# @sensitive
GOOGLE_CLIENT_SECRET=op(op://LifeOS/google-oauth/client-secret)
```

- [ ] **Step 2: Verify Varlock resolves the schema**

```bash
cd plugin/mcp-server
varlock load
```

Expected: Varlock resolves both values from 1Password without errors. If 1Password app auth prompts for biometric, approve it.

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/.env.schema
git commit -m "feat: add Varlock .env.schema for Google OAuth credentials via 1Password"
```

---

### Task 3: Schema Migration V2

**Files:**
- Modify: `plugin/mcp-server/src/index-db.ts:6-8` (SCHEMA_VERSION)
- Modify: `plugin/mcp-server/src/index-db.ts:44-51` (runMigrations)

- [ ] **Step 1: Bump SCHEMA_VERSION to 2**

In `plugin/mcp-server/src/index-db.ts`, change line 7:

```typescript
const SCHEMA_VERSION = 2;
```

- [ ] **Step 2: Add migrateV2 function**

Add this function after the `migrateV1` function (after the closing `}` of `migrateV1`):

```typescript
function migrateV2(db: DatabaseType): void {
  db.exec(`
    ALTER TABLE external_accounts ADD COLUMN refresh_token TEXT;
  `);
}
```

- [ ] **Step 3: Update runMigrations to call migrateV2**

Replace the `runMigrations` function:

```typescript
function runMigrations(db: DatabaseType): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion < 1) {
    migrateV1(db);
  }
  if (currentVersion < 2) {
    migrateV2(db);
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
```

- [ ] **Step 4: Verify migration runs on existing database**

```bash
cd plugin/mcp-server
npm run build
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | OBSIDIAN_VAULT_PATH="$HOME/LifeOS" timeout 5 node dist/index.js 2>&1 | head -5
```

Expected: Server starts without errors. Check stderr for vault sync line (no migration errors).

Then verify the column exists:

```bash
sqlite3 "$HOME/LifeOS/.vault-index.db" ".schema external_accounts"
```

Expected: Schema includes `refresh_token TEXT`.

- [ ] **Step 5: Commit**

```bash
git add plugin/mcp-server/src/index-db.ts
git commit -m "feat: schema migration V2 — add refresh_token column to external_accounts"
```

---

### Task 4: Create google-oauth.ts

**Files:**
- Create: `plugin/mcp-server/src/google-oauth.ts`

- [ ] **Step 1: Create the OAuth2 module**

Create `plugin/mcp-server/src/google-oauth.ts`:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import open from "open";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");
const CALLBACK_PORT_START = 8914;
const CALLBACK_PORT_END = 8924;
const AUTH_TIMEOUT_MS = 120_000;

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/** Build the Google OAuth consent URL */
export function generateAuthUrl(
  clientId: string,
  redirectUri: string,
  email: string,
  state: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
    login_hint: email,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params}`;
}

/** Exchange an authorization code for tokens */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<TokenResponse>;
}

/** Use a refresh token to get a fresh access token */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && body.includes("invalid_grant")) {
      throw new Error(
        "Refresh token has been revoked. Run account_register again to re-authorize.",
      );
    }
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<TokenResponse>;
}

/**
 * Orchestrate the full OAuth2 authorization flow for an account.
 * Opens browser → catches callback → exchanges code → returns tokens.
 */
export async function authorizeAccount(
  email: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenResponse> {
  const state = randomBytes(16).toString("hex");

  // Start callback server (finds an open port)
  const callbackPromise = startCallbackServer();

  // We need the port before we can build the auth URL, but the server
  // resolves with the code, not the port. Use a small workaround:
  // start the server, wait a tick for it to bind, then read the port.
  // Actually, the promise resolves only on callback. We need a different approach.

  // Start server and get port synchronously-ish via a wrapper
  const { code, port, server } = await new Promise<{ code: string; port: number; server: import("node:http").Server }>(
    (resolve, reject) => {
      let serverInstance: import("node:http").Server;
      let boundPort: number;
      let resolved = false;

      const httpServer = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const authCode = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const returnedState = url.searchParams.get("state");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authorization failed</h2><p>You can close this tab.</p></body></html>");
          if (!resolved) {
            resolved = true;
            reject(new Error(`OAuth authorization failed: ${error}`));
          }
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h2>State mismatch</h2><p>Possible CSRF attack. Try again.</p></body></html>");
          if (!resolved) {
            resolved = true;
            reject(new Error("OAuth state mismatch — possible CSRF attack. Try again."));
          }
          return;
        }

        if (!authCode) {
          res.writeHead(400);
          res.end("Missing authorization code");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Authorization successful!</h2><p>You can close this tab and return to the terminal.</p></body></html>");

        if (!resolved) {
          resolved = true;
          resolve({ code: authCode, port: boundPort, server: httpServer });
        }
      });

      let port = CALLBACK_PORT_START;
      const tryListen = () => {
        httpServer.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE" && port < CALLBACK_PORT_END) {
            port++;
            tryListen();
          } else if (!resolved) {
            resolved = true;
            reject(new Error(`Cannot start OAuth callback server: ${err.message}`));
          }
        });

        httpServer.listen(port, "127.0.0.1", () => {
          boundPort = port;
          serverInstance = httpServer;

          // Server is listening — open browser
          const redirectUri = `http://localhost:${boundPort}/callback`;
          const authUrl = generateAuthUrl(clientId, redirectUri, email, state);
          console.error(`Opening browser for OAuth consent (${email})...`);
          open(authUrl).catch(() => {
            console.error(`Could not open browser. Please visit:\n${authUrl}`);
          });
        });
      };
      tryListen();

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          httpServer.close();
          reject(new Error("OAuth authorization timed out after 120 seconds. Run account_register again."));
        }
      }, AUTH_TIMEOUT_MS);
    },
  );

  // Exchange code for tokens
  const redirectUri = `http://localhost:${port}/callback`;
  const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);

  // Shut down the callback server
  server.close();

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token received. This can happen if the account was previously authorized. " +
      "Revoke app access at https://myaccount.google.com/permissions and try again.",
    );
  }

  return tokens;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd plugin/mcp-server
npm run build
```

Expected: Clean compilation. If there are `open` import issues, ensure `"esModuleInterop": true` or `"allowSyntheticDefaultImports": true` is in `tsconfig.json`, or use `import open from "open"` (open v10+ is ESM-native).

- [ ] **Step 3: Commit**

```bash
git add plugin/mcp-server/src/google-oauth.ts
git commit -m "feat: add google-oauth.ts — native OAuth2 authorization code flow"
```

---

### Task 5: Modify getAccessToken and syncAccount

**Files:**
- Modify: `plugin/mcp-server/src/google-api.ts:1-22` (imports + getAccessToken)
- Modify: `plugin/mcp-server/src/google-api.ts:216-224` (syncAccount)

- [ ] **Step 1: Replace the getAccessToken function**

In `plugin/mcp-server/src/google-api.ts`, replace lines 1-22 with:

```typescript
import { execFileSync } from "node:child_process";
import type { Database as DatabaseType } from "better-sqlite3";
import { refreshAccessToken } from "./google-oauth.js";

// ─── Token Acquisition ────────────────────────────────────────────────────

/**
 * Get an access token for a Google account.
 * Prefers OAuth2 refresh token if available and client credentials are set.
 * Falls back to gcloud CLI if not.
 */
export async function getAccessToken(
  db: DatabaseType,
  accountId: string,
): Promise<string> {
  const account = db
    .prepare("SELECT account_email, refresh_token FROM external_accounts WHERE id = ?")
    .get(accountId) as { account_email: string; refresh_token: string | null } | undefined;

  if (!account) {
    throw new Error(`Account "${accountId}" not found in external_accounts`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  // OAuth2 path: use stored refresh token
  if (account.refresh_token && clientId && clientSecret) {
    const tokens = await refreshAccessToken(account.refresh_token, clientId, clientSecret);
    return tokens.access_token;
  }

  // Fallback: gcloud CLI
  if (account.refresh_token && (!clientId || !clientSecret)) {
    console.error(
      `Warning: Account "${accountId}" has a refresh token but GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set. Falling back to gcloud.`,
    );
  }

  try {
    const token = execFileSync(
      "gcloud",
      ["auth", "print-access-token", `--account=${account.account_email}`],
      { encoding: "utf-8", timeout: 15000 },
    ).trim();
    if (!token) throw new Error(`Empty token returned for ${account.account_email}`);
    return token;
  } catch (e) {
    throw new Error(
      `Failed to get access token for ${account.account_email}. ` +
      `Either configure OAuth (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET via Varlock) ` +
      `or run: gcloud auth login ${account.account_email}\n${e}`,
    );
  }
}
```

- [ ] **Step 2: Update syncAccount to use the new getAccessToken signature**

In `plugin/mcp-server/src/google-api.ts`, find the `syncAccount` function (around line 216). Replace the function signature and the first two lines of the body:

Change:

```typescript
export async function syncAccount(
  db: DatabaseType,
  accountId: string,
  email: string,
  options: {
    timeZone?: string;
  } = {},
): Promise<{ calendar_events_synced: number; emails_synced: number }> {
  const token = getAccessToken(email);
  const now = Date.now();
```

To:

```typescript
export async function syncAccount(
  db: DatabaseType,
  accountId: string,
  email: string,
  options: {
    timeZone?: string;
  } = {},
): Promise<{ calendar_events_synced: number; emails_synced: number }> {
  const token = await getAccessToken(db, accountId);
  const now = Date.now();
```

The only change is `getAccessToken(email)` → `await getAccessToken(db, accountId)`. The rest of `syncAccount` is unchanged.

- [ ] **Step 3: Verify build**

```bash
cd plugin/mcp-server
npm run build
```

Expected: Clean compilation. The `syncAccount` callers in `external.ts` already pass `db` and `account.id`, so no downstream type errors.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/src/google-api.ts
git commit -m "feat: getAccessToken uses OAuth2 refresh tokens with gcloud fallback"
```

---

### Task 6: Modify accountRegister and accountSync

**Files:**
- Modify: `plugin/mcp-server/src/tools/external.ts`

- [ ] **Step 1: Replace the entire file**

Replace `plugin/mcp-server/src/tools/external.ts` with:

```typescript
import type { Database as DatabaseType } from "better-sqlite3";
import { syncAccount } from "../google-api.js";
import { authorizeAccount } from "../google-oauth.js";

/** account_register — register a Google account for syncing */
export async function accountRegister(
  db: DatabaseType,
  options: {
    id: string;
    email: string;
    context?: string;
  },
): Promise<{ id: string; email: string; context: string | null; message: string } | { error: string; message: string }> {
  const { id, email, context } = options;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  // Check if account already exists
  const existing = db.prepare("SELECT id, refresh_token FROM external_accounts WHERE id = ?").get(id) as
    { id: string; refresh_token: string | null } | undefined;

  if (existing && !clientId) {
    // No OAuth credentials — can't re-authorize, so reject duplicate
    return { error: "account_exists", message: `Account "${id}" already registered. Use a different id.` };
  }

  let refreshToken: string | null = null;

  if (clientId && clientSecret) {
    // OAuth2 path: open browser for consent
    try {
      const tokens = await authorizeAccount(email, clientId, clientSecret);
      refreshToken = tokens.refresh_token ?? null;
    } catch (e) {
      return {
        error: "oauth_failed",
        message: `OAuth authorization failed for ${email}: ${e}`,
      };
    }
  } else {
    // Fallback: verify gcloud auth works (legacy path)
    const { execFileSync } = await import("node:child_process");
    try {
      const token = execFileSync(
        "gcloud",
        ["auth", "print-access-token", `--account=${email}`],
        { encoding: "utf-8", timeout: 15000 },
      ).trim();
      if (!token) throw new Error("Empty token");
    } catch (e) {
      return {
        error: "auth_failed",
        message: `Cannot authenticate ${email}. Either configure OAuth (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET via Varlock) or run: gcloud auth login ${email}\n${e}`,
      };
    }
    console.error(
      "Warning: OAuth not configured. Calendar/Gmail sync will not work without GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }

  if (existing) {
    // Re-authorization: update refresh token in place
    db.prepare(
      "UPDATE external_accounts SET refresh_token = ?, account_email = ?, context = ? WHERE id = ?",
    ).run(refreshToken, email, context ?? null, id);
    return { id, email, context: context ?? null, message: `Account "${id}" (${email}) re-authorized.` };
  }

  // New registration
  db.prepare(
    "INSERT INTO external_accounts (id, provider, account_email, context, refresh_token) VALUES (?, 'google', ?, ?, ?)",
  ).run(id, email, context ?? null, refreshToken);

  return { id, email, context: context ?? null, message: `Account "${id}" (${email}) registered.` };
}

/** account_sync — sync calendar and email data for one or all accounts */
export async function accountSync(
  db: DatabaseType,
  options: {
    id?: string;
    timeZone?: string;
  } = {},
): Promise<{
  accounts: Array<{
    id: string;
    email: string;
    calendar_events_synced: number;
    emails_synced: number;
    error?: string;
  }>;
}> {
  let accounts: Array<{ id: string; account_email: string }>;

  if (options.id) {
    const account = db.prepare("SELECT id, account_email FROM external_accounts WHERE id = ?").get(options.id) as
      { id: string; account_email: string } | undefined;
    if (!account) {
      return { accounts: [{ id: options.id, email: "", calendar_events_synced: 0, emails_synced: 0, error: `Account "${options.id}" not found` }] };
    }
    accounts = [account];
  } else {
    accounts = db.prepare("SELECT id, account_email FROM external_accounts").all() as typeof accounts;
  }

  const results: Array<{
    id: string;
    email: string;
    calendar_events_synced: number;
    emails_synced: number;
    error?: string;
  }> = [];

  for (const account of accounts) {
    try {
      const result = await syncAccount(db, account.id, account.account_email, {
        timeZone: options.timeZone,
      });
      results.push({
        id: account.id,
        email: account.account_email,
        ...result,
      });
    } catch (e) {
      results.push({
        id: account.id,
        email: account.account_email,
        calendar_events_synced: 0,
        emails_synced: 0,
        error: String(e),
      });
    }
  }

  return { accounts: results };
}
```

Key changes from the original:
- `accountRegister` is now `async` (the OAuth flow is async)
- If OAuth credentials are set: runs `authorizeAccount()` browser flow, stores refresh token
- If account already exists and OAuth is available: re-authorizes (updates refresh token)
- If no OAuth credentials: falls back to gcloud verification with a warning
- `accountSync` is unchanged except it no longer imports `getAccessToken` (it wasn't using it directly)

- [ ] **Step 2: Update the tool registration in index.ts if accountRegister is now async**

Check `plugin/mcp-server/src/index.ts` for how `accountRegister` is called. Find the `server.tool()` call for `account_register`. If the handler already uses `async` and `await`, no change is needed. If it calls `accountRegister` synchronously, add `await`.

Search for `account_register` in `index.ts` and ensure the handler awaits the result:

```typescript
// The handler should look like:
server.tool("account_register", ..., async ({ ... }) => {
  const result = await accountRegister(db!, { id, email, context });
  // ...
});
```

If it was previously synchronous (`const result = accountRegister(...)`), add `await`.

- [ ] **Step 3: Verify build**

```bash
cd plugin/mcp-server
npm run build
```

Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add plugin/mcp-server/src/tools/external.ts plugin/mcp-server/src/index.ts
git commit -m "feat: accountRegister uses OAuth2 browser flow with gcloud fallback"
```

---

### Task 7: End-to-End Verification

**Files:** None (manual testing)

- [ ] **Step 1: Build the project**

```bash
cd plugin/mcp-server
npm run build
```

- [ ] **Step 2: Re-register the personal account to test OAuth flow**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"account_register","arguments":{"id":"personal","email":"tony.semana@gmail.com","context":"personal"}}}' | varlock run -- node dist/index.js 2>&1
```

Expected: Browser opens with Google consent screen for `tony.semana@gmail.com`. After approving, the terminal should show the account registered/re-authorized message.

- [ ] **Step 3: Verify refresh token is stored**

```bash
sqlite3 "$HOME/LifeOS/.vault-index.db" "SELECT id, account_email, CASE WHEN refresh_token IS NOT NULL THEN 'YES' ELSE 'NO' END as has_token FROM external_accounts;"
```

Expected: `personal` shows `YES` for `has_token`.

- [ ] **Step 4: Test account sync**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"account_sync","arguments":{"id":"personal"}}}' | OBSIDIAN_VAULT_PATH="$HOME/LifeOS" varlock run -- node dist/index.js 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin); print(json.dumps(r['result'],indent=2))"
```

Expected: `calendar_events_synced > 0` and/or `emails_synced > 0` (depending on what's in your calendar/inbox).

- [ ] **Step 5: Register remaining accounts**

Repeat the OAuth flow for:
- `vetsource` / `tsemana@vetsource.com` / `work`
- `semantechs` / `tony@semantechs.io` / `consulting`
- `kogarashi` / `tony@kogarashidojo.com` / `dojo`

- [ ] **Step 6: Test radar_data with all sources**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"radar_data","arguments":{"lookahead_days":3}}}' | OBSIDIAN_VAULT_PATH="$HOME/LifeOS" varlock run -- node dist/index.js 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin); d=json.loads(r['result']['content'][0]['text']); print('Calendar events:', len(d.get('calendar',{}).get('events',[]))); print('Email highlights:', len(d.get('email',{}).get('highlights',[]))); print('Sources:', d.get('sources_available',{}))"
```

Expected: `calendar: true`, `email: true`, non-zero event and email counts.

- [ ] **Step 7: Rebuild dist/ and commit**

```bash
cd plugin/mcp-server
npm run build
git add plugin/mcp-server/dist/
git commit -m "chore: rebuild dist/ with OAuth2 support"
```

---

### Task 8: Update Documentation

**Files:**
- Modify: `status.md`

- [ ] **Step 1: Update status.md with OAuth fix**

Add a new entry in the post-merge fixes table and update the Calendar/Gmail status from the known issue note.

- [ ] **Step 2: Commit**

```bash
git add status.md
git commit -m "docs: update status.md — OAuth2 for Calendar/Gmail APIs (SP3)"
```
