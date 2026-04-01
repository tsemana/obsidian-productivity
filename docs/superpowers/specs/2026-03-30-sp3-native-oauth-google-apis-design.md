# SP3: Native OAuth2 for Google Calendar & Gmail APIs

**Date:** 2026-03-30
**Status:** Approved
**Scope:** Replace gcloud-CLI-based token acquisition with native OAuth2 flow so the MCP server can access Google Calendar and Gmail APIs with the correct scopes.

---

## Problem

The MCP server uses `gcloud auth print-access-token` to get OAuth tokens for Google API calls. However, `gcloud auth login` only grants GCP-platform scopes — it does not include `calendar.readonly` or `gmail.readonly`. The Calendar and Gmail REST APIs return `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`.

This means `account_sync`, `radar_generate`, `radar_data`, and all calendar/email features are non-functional despite accounts being registered and gcloud auth working.

## Solution

Implement a native OAuth2 authorization code flow directly in the MCP server:

1. User creates a GCP project with Calendar + Gmail APIs enabled and a Desktop-type OAuth Client ID (one-time setup).
2. Client credentials (client_id, client_secret) are stored in 1Password and resolved at runtime via Varlock.
3. On `account_register`, the MCP server opens a browser for Google OAuth consent, catches the callback on a temporary localhost HTTP server, exchanges the auth code for tokens, and stores the refresh token in SQLite.
4. On API calls, `getAccessToken` uses the stored refresh token to mint fresh access tokens via Google's token endpoint. No gcloud dependency.

## Prerequisites (User Setup)

### GCP Project

1. Create a project in Google Cloud Console (e.g., "LifeOS Productivity")
2. Enable **Google Calendar API** and **Gmail API** in APIs & Services > Library
3. Configure OAuth consent screen: External, testing mode
4. Add all Google account emails as test users in Audience settings
5. Create an OAuth 2.0 Client ID with application type **Desktop app**

### 1Password + Varlock

1. Create a Login item in 1Password (e.g., `google-oauth` in vault `LifeOS`)
   - Custom field `client-id` → OAuth Client ID
   - Custom field `client-secret` → OAuth Client Secret
2. The `.env.schema` in the MCP server references these via `op://`:
   ```
   GOOGLE_CLIENT_ID=op(op://LifeOS/google-oauth/client-id)
   GOOGLE_CLIENT_SECRET=op(op://LifeOS/google-oauth/client-secret)
   ```

## OAuth2 Flow Detail

### Scopes Requested

```
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/gmail.readonly
```

Minimum read-only access. No write permissions requested.

### Authorization (account_register)

```
1. Read GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from process.env
2. Generate a random `state` parameter for CSRF protection
3. Build Google OAuth consent URL:
   - endpoint: https://accounts.google.com/o/oauth2/v2/auth
   - response_type: code
   - client_id: from env
   - redirect_uri: http://localhost:{port}/callback
   - scope: calendar.readonly gmail.readonly
   - access_type: offline (to get a refresh_token)
   - prompt: consent (force re-consent to always get refresh_token)
   - state: random string
   - login_hint: account email (pre-selects the right Google account)
4. Start a temporary HTTP server on localhost (port 8914, incrementing if busy, up to 8924)
5. Open the consent URL in the user's default browser
6. Wait for Google to redirect to localhost with ?code=...&state=...
7. Verify state matches
8. Exchange the code for tokens:
   - POST https://oauth2.googleapis.com/token
   - grant_type: authorization_code
   - code, client_id, client_secret, redirect_uri
9. Receive: { access_token, refresh_token, expires_in, token_type }
10. Store refresh_token in external_accounts.refresh_token
11. Shut down the temporary HTTP server
12. Return success with account details
```

### Token Refresh (getAccessToken)

```
1. Read refresh_token from external_accounts for the given account ID
2. POST https://oauth2.googleapis.com/token
   - grant_type: refresh_token
   - refresh_token, client_id, client_secret
3. Receive: { access_token, expires_in, token_type }
4. Return access_token (not stored — ephemeral)
```

If the refresh fails with `invalid_grant`, the refresh token has been revoked. Throw an error instructing the user to re-register the account.

## File Changes

### New Files

#### `plugin/mcp-server/.env.schema`

Varlock schema for OAuth credentials:

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

#### `plugin/mcp-server/src/google-oauth.ts`

New module containing:

- `generateAuthUrl(clientId, redirectUri, email, state)` — builds the Google OAuth consent URL
- `startCallbackServer(port?)` — starts a temporary HTTP server, returns a promise that resolves with the auth code
- `exchangeCodeForTokens(code, clientId, clientSecret, redirectUri)` — POST to token endpoint, returns `{ access_token, refresh_token, expires_in }`
- `refreshAccessToken(refreshToken, clientId, clientSecret)` — POST to token endpoint with `grant_type=refresh_token`, returns `{ access_token, expires_in }`
- `authorizeAccount(email)` — orchestrates the full flow: start server, open browser, wait for callback, exchange code. Returns the token response.

Dependencies: Node.js built-in `http` module for the callback server, `open` npm package to launch the browser.

### Modified Files

#### `plugin/mcp-server/src/google-api.ts`

- `getAccessToken(email)` → `getAccessToken(db, accountId)`:
  - Read `refresh_token` and `account_email` from `external_accounts` where `id = accountId`
  - If `refresh_token` exists and `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` are set: use `refreshAccessToken()` from `google-oauth.ts`
  - Else: fall back to `gcloud auth print-access-token --account={email}` (existing behavior)
  - Log a warning if falling back to gcloud
- `syncAccount()` signature updates to pass `db` and `accountId` instead of just `email` to `getAccessToken`
- No changes to `fetchCalendarEvents()` or `fetchEmails()` — they already accept a token string

#### `plugin/mcp-server/src/tools/external.ts`

- `accountRegister()`:
  - If `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set: call `authorizeAccount(email)` to run the OAuth flow, store the returned `refresh_token` in the DB
  - If not set: fall back to existing `getAccessToken(email)` gcloud verification
  - Support re-registration: if account ID already exists, update the `refresh_token` instead of rejecting (enables `--reauth` use case)
- `accountSync()`: update `getAccessToken` call signature (pass `db` + `accountId`)

#### `plugin/mcp-server/src/index-db.ts`

- Add migration V2:
  ```sql
  ALTER TABLE external_accounts ADD COLUMN refresh_token TEXT;
  ```
- Bump `SCHEMA_VERSION` to 2

#### `plugin/mcp-server/package.json`

- Add dependencies: `varlock`, `open`
- Update `scripts.dev` and `scripts.start` to use `varlock run --` prefix (so env vars are resolved)

### Not Changed

- `fetchCalendarEvents()`, `fetchEmails()` — accept a token string, unchanged
- All composite tools (`radar_data`, `weekly_review`, etc.) — call `accountSync` which calls `getAccessToken`, so they get the fix transparently
- All other tool modules (notes, tasks, memory, wikilinks, etc.) — unaffected
- Skills and commands — no changes needed
- SQLite schema for `calendar_events`, `email_cache` — unchanged

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` not set | Fall back to gcloud `print-access-token`. Log warning: "OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET via Varlock for Calendar/Gmail access." |
| Port 8914 busy | Increment port up to 8924. If all busy, error: "Cannot start OAuth callback server — ports 8914-8924 are all in use." |
| User closes browser without completing consent | Callback server times out after 120 seconds. Error: "OAuth authorization timed out. Run account_register again." |
| Refresh token revoked (user removes app in Google settings) | `refreshAccessToken` returns `invalid_grant`. Error: "Refresh token revoked for account '{id}'. Run account_register again to re-authorize." |
| Account already exists on `account_register` | Instead of rejecting, update the `refresh_token` in place (re-authorization flow). Return success with note: "Account '{id}' re-authorized." |
| Google API returns 403 despite valid token | Likely APIs not enabled on GCP project. Error message includes: "Ensure Google Calendar API and Gmail API are enabled in your GCP project." |
| `state` parameter mismatch on callback | Reject the callback. Error: "OAuth state mismatch — possible CSRF attack. Try again." |

## Backwards Compatibility

The gcloud fallback path ensures existing users who haven't set up OAuth credentials can still use all non-Google-API features. The only behavior change is that `account_register` will attempt the OAuth browser flow when credentials are available, which is strictly better than the current experience (register succeeds but sync silently fails).

## Testing

Manual verification checklist:
- [ ] `varlock load` validates `.env.schema` successfully
- [ ] `account_register` opens browser and completes OAuth consent
- [ ] `refresh_token` is stored in `external_accounts` table
- [ ] `account_sync` fetches calendar events and emails for all 4 accounts
- [ ] `radar_data` returns non-empty `calendar` and `email` arrays
- [ ] `radar_generate` produces HTML with schedule and email sections
- [ ] Re-registering an existing account replaces the refresh token
- [ ] Without `GOOGLE_CLIENT_ID` set, gcloud fallback works and logs a warning
- [ ] Revoking app access in Google account settings triggers clear re-auth error
