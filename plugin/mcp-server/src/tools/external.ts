import { execFileSync } from "node:child_process";
import type { Database as DatabaseType } from "better-sqlite3";
import { syncAccount } from "../google-api.js";

/** account_register — register a Google account for syncing */
export function accountRegister(
  db: DatabaseType,
  options: {
    id: string;
    email: string;
    context?: string;
  },
): { id: string; email: string; context: string | null; message: string } | { error: string; message: string } {
  const { id, email, context } = options;

  // Check if account already exists
  const existing = db.prepare("SELECT id FROM external_accounts WHERE id = ?").get(id);
  if (existing) {
    return { error: "account_exists", message: `Account "${id}" already registered. Use a different id.` };
  }

  // Verify gcloud authentication (only when OAuth credentials are not configured)
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    try {
      const token = execFileSync(
        "gcloud",
        ["auth", "print-access-token", `--account=${email}`],
        { encoding: "utf-8", timeout: 15000 },
      ).trim();
      if (!token) throw new Error("Empty token returned");
    } catch (e) {
      return {
        error: "auth_failed",
        message: `Cannot authenticate ${email}. Run: gcloud auth login ${email}\n${e}`,
      };
    }
  }

  db.prepare(
    "INSERT INTO external_accounts (id, provider, account_email, context) VALUES (?, 'google', ?, ?)",
  ).run(id, email, context ?? null);

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
