import { syncAccount } from "../google-api.js";
import { authorizeAccount } from "../google-oauth.js";
/** account_register — register a Google account for syncing */
export async function accountRegister(db, options) {
    const { id, email, context } = options;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    // Check if account already exists
    const existing = db.prepare("SELECT id, refresh_token FROM external_accounts WHERE id = ?").get(id);
    if (existing && !clientId) {
        // No OAuth credentials — can't re-authorize, so reject duplicate
        return { error: "account_exists", message: `Account "${id}" already registered. Use a different id.` };
    }
    let refreshToken = null;
    if (clientId && clientSecret) {
        // OAuth2 path: open browser for consent
        try {
            const tokens = await authorizeAccount(email, clientId, clientSecret);
            refreshToken = tokens.refresh_token ?? null;
        }
        catch (e) {
            return {
                error: "oauth_failed",
                message: `OAuth authorization failed for ${email}: ${e}`,
            };
        }
    }
    else {
        // Fallback: verify gcloud auth works (legacy path)
        const { execFileSync } = await import("node:child_process");
        try {
            const token = execFileSync("gcloud", ["auth", "print-access-token", `--account=${email}`], { encoding: "utf-8", timeout: 15000 }).trim();
            if (!token)
                throw new Error("Empty token");
        }
        catch (e) {
            return {
                error: "auth_failed",
                message: `Cannot authenticate ${email}. Either configure OAuth (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET via Varlock) or run: gcloud auth login ${email}\n${e}`,
            };
        }
        console.error("Warning: OAuth not configured. Calendar/Gmail sync will not work without GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    }
    if (existing) {
        // Re-authorization: update refresh token in place
        db.prepare("UPDATE external_accounts SET refresh_token = ?, account_email = ?, context = ? WHERE id = ?").run(refreshToken, email, context ?? null, id);
        return { id, email, context: context ?? null, message: `Account "${id}" (${email}) re-authorized.` };
    }
    // New registration
    db.prepare("INSERT INTO external_accounts (id, provider, account_email, context, refresh_token) VALUES (?, 'google', ?, ?, ?)").run(id, email, context ?? null, refreshToken);
    return { id, email, context: context ?? null, message: `Account "${id}" (${email}) registered.` };
}
/** account_sync — sync calendar and email data for one or all accounts */
export async function accountSync(db, options = {}) {
    let accounts;
    if (options.id) {
        const account = db.prepare("SELECT id, account_email FROM external_accounts WHERE id = ?").get(options.id);
        if (!account) {
            return { accounts: [{ id: options.id, email: "", calendar_events_synced: 0, emails_synced: 0, error: `Account "${options.id}" not found` }] };
        }
        accounts = [account];
    }
    else {
        accounts = db.prepare("SELECT id, account_email FROM external_accounts").all();
    }
    const results = [];
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
        }
        catch (e) {
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
//# sourceMappingURL=external.js.map