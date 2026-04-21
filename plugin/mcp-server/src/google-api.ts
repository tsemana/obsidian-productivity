import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { refreshAccessToken } from "./google-oauth.js";
import { loadRefreshToken, storeRefreshToken } from "./token-store.js";

interface HermesWorkspaceProfileToken {
  token?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  expiry?: string;
  scopes?: string[];
  scope?: string;
  account?: string;
}

function hermesProfilesRoot(): string {
  return join(process.env.HERMES_HOME ?? join(homedir(), ".hermes"), "google_workspace_profiles");
}

function parseProfileToken(profileDir: string): HermesWorkspaceProfileToken | null {
  const path = join(profileDir, "google_token.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as HermesWorkspaceProfileToken;
  } catch {
    return null;
  }
}

function grantedScopes(token: HermesWorkspaceProfileToken | null): Set<string> {
  if (!token) return new Set();
  const raw = token.scopes ?? token.scope ?? [];
  const scopes = Array.isArray(raw) ? raw : String(raw).split(/\s+/);
  return new Set(scopes.map((s) => s.trim()).filter(Boolean));
}

function findHermesProfileToken(options: { accountId?: string; accountEmail?: string; requiredScopes?: string[] } = {}): { profileId: string; token: HermesWorkspaceProfileToken } | null {
  const root = hermesProfilesRoot();
  if (!existsSync(root)) return null;

  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const requiredScopes = options.requiredScopes ?? [];
  const exactCandidates = options.accountId ? dirs.filter((dir) => dir === options.accountId) : [];
  const orderedDirs = [...exactCandidates, ...dirs.filter((dir) => dir !== options.accountId)];

  for (const dir of orderedDirs) {
    const token = parseProfileToken(join(root, dir));
    if (!token) continue;
    const scopes = grantedScopes(token);
    if (requiredScopes.some((scope) => !scopes.has(scope))) continue;
    if (options.accountEmail) {
      const tokenEmail = token.account?.trim().toLowerCase() ?? "";
      if (tokenEmail && tokenEmail !== options.accountEmail.trim().toLowerCase()) continue;
    }
    return { profileId: dir, token };
  }

  return null;
}

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
  let refreshToken = loadRefreshToken(accountId);
  const hermesProfile = findHermesProfileToken({ accountId, accountEmail: account.account_email });
  const hermesClientId = hermesProfile?.token.client_id ?? null;
  const hermesClientSecret = hermesProfile?.token.client_secret ?? null;
  const effectiveClientId = clientId || hermesClientId || undefined;
  const effectiveClientSecret = clientSecret || hermesClientSecret || undefined;

  if (!refreshToken && account.refresh_token) {
    refreshToken = account.refresh_token;
    storeRefreshToken(accountId, account.refresh_token);
    db.prepare("UPDATE external_accounts SET refresh_token = NULL WHERE id = ?").run(accountId);
  }

  if (!refreshToken && hermesProfile?.token.refresh_token) {
    refreshToken = hermesProfile.token.refresh_token;
    storeRefreshToken(accountId, refreshToken);
  }

  // OAuth2 path: use stored refresh token
  if (refreshToken && effectiveClientId && effectiveClientSecret) {
    const tokens = await refreshAccessToken(refreshToken, effectiveClientId, effectiveClientSecret);
    return tokens.access_token;
  }

  // Hermes profile token fallback: use cached access token if still valid
  if (hermesProfile?.token.token && hermesProfile.token.expiry) {
    const expiryMs = Date.parse(hermesProfile.token.expiry);
    if (!Number.isNaN(expiryMs) && expiryMs > Date.now() + 60_000) {
      return hermesProfile.token.token;
    }
  }

  // Fallback: gcloud CLI
  if (refreshToken && (!effectiveClientId || !effectiveClientSecret)) {
    console.error(
      `Warning: Account "${accountId}" has a refresh token but no OAuth client credentials are available in env or Hermes profile storage. Falling back to gcloud.`,
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
      `Either configure OAuth credentials in .env.schema (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET) ` +
      `or run: gcloud auth login ${account.account_email}\n${e}`,
    );
  }
}

// ─── Calendar Client ──────────────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  calendar_id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  attendees: string[];
  location: string | null;
  description: string | null;
  html_link: string | null;
  rsvp_status: string | null;
}

/** Fetch calendar events for an account */
export async function fetchCalendarEvents(
  token: string,
  options: {
    timeMin?: string;
    timeMax?: string;
    timeZone?: string;
  } = {},
): Promise<CalendarEvent[]> {
  const now = new Date();
  const timeMin = options.timeMin ?? new Date(now.getTime() - 7 * 86400000).toISOString();
  const timeMax = options.timeMax ?? new Date(now.getTime() + 14 * 86400000).toISOString();
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // First, list all calendars
  const calendarsUrl = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
  const calendarsRes = await fetch(calendarsUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!calendarsRes.ok) {
    throw new Error(`Calendar list failed: ${calendarsRes.status} ${await calendarsRes.text()}`);
  }
  const calendarsData = await calendarsRes.json() as {
    items?: Array<{ id: string; selected?: boolean; accessRole?: string; primary?: boolean }>;
  };
  // Filter to calendars the user owns or has write access to.
  // This excludes "other people's calendars" (subscribed read-only calendars)
  // and holiday/birthday calendars that show up as reader access.
  // To include shared calendars you can write to, we allow "owner" and "writer".
  const ownedRoles = new Set(["owner", "writer"]);
  const calendarIds = (calendarsData.items ?? [])
    .filter((c) => c.primary || ownedRoles.has(c.accessRole ?? ""))
    .map((c) => c.id);

  const allEvents: CalendarEvent[] = [];

  for (const calendarId of calendarIds) {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        timeZone,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
      const eventsRes = await fetch(eventsUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!eventsRes.ok) {
        // Skip calendars we can't read (permissions)
        break;
      }
      const eventsData = await eventsRes.json() as {
        items?: Array<{
          id: string;
          summary?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
          attendees?: Array<{ email: string; responseStatus?: string; self?: boolean }>;
          location?: string;
          description?: string;
          htmlLink?: string;
          status?: string;
        }>;
        nextPageToken?: string;
      };

      for (const event of eventsData.items ?? []) {
        if (event.status === "cancelled") continue;

        const isAllDay = !event.start?.dateTime;
        const selfAttendee = event.attendees?.find((a) => a.self);

        allEvents.push({
          id: event.id,
          calendar_id: calendarId,
          title: event.summary ?? "(No title)",
          start_time: event.start?.dateTime ?? event.start?.date ?? "",
          end_time: event.end?.dateTime ?? event.end?.date ?? null,
          all_day: isAllDay,
          attendees: (event.attendees ?? []).map((a) => a.email),
          location: event.location ?? null,
          description: event.description ?? null,
          html_link: event.htmlLink ?? null,
          rsvp_status: selfAttendee?.responseStatus ?? null,
        });
      }

      pageToken = eventsData.nextPageToken;
    } while (pageToken);
  }

  return allEvents;
}

// ─── Gmail Client ─────────────────────────────────────────────────────────

interface EmailMessage {
  id: string;
  thread_id: string;
  subject: string;
  sender: string;
  date: string;
  labels: string[];
  snippet: string;
  is_starred: boolean;
  is_important: boolean;
  html_link: string;
}

/** Fetch email messages for an account */
export async function fetchEmails(
  token: string,
  accountEmail: string,
  options: {
    query?: string;
    maxResults?: number;
  } = {},
): Promise<EmailMessage[]> {
  const query = options.query ?? "is:unread (is:important OR is:starred)";
  const maxResults = options.maxResults ?? 20;

  // List message IDs
  const listParams = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const listUrl = `https://www.googleapis.com/gmail/v1/users/me/messages?${listParams}`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    throw new Error(`Gmail list failed: ${listRes.status} ${await listRes.text()}`);
  }
  const listData = await listRes.json() as { messages?: Array<{ id: string; threadId: string }> };

  if (!listData.messages || listData.messages.length === 0) {
    return [];
  }

  // Fetch each message's details
  const messages: EmailMessage[] = [];
  for (const msg of listData.messages) {
    const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
    const msgRes = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!msgRes.ok) continue;

    const msgData = await msgRes.json() as {
      id: string;
      threadId: string;
      labelIds?: string[];
      snippet?: string;
      payload?: {
        headers?: Array<{ name: string; value: string }>;
      };
    };

    const headers = msgData.payload?.headers ?? [];
    const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
    const labels = msgData.labelIds ?? [];

    messages.push({
      id: msgData.id,
      thread_id: msgData.threadId,
      subject: getHeader("Subject"),
      sender: getHeader("From"),
      date: getHeader("Date"),
      labels,
      snippet: msgData.snippet ?? "",
      is_starred: labels.includes("STARRED"),
      is_important: labels.includes("IMPORTANT"),
      html_link: `https://mail.google.com/mail/u/0/#inbox/${msgData.threadId}`,
    });
  }

  return messages;
}

// ─── Cache Sync ───────────────────────────────────────────────────────────

/** Sync a single account's calendar and email data into SQLite cache */
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

  // Fetch calendar and email in parallel — independent APIs
  const [events, emails] = await Promise.all([
    fetchCalendarEvents(token, { timeZone: options.timeZone }),
    fetchEmails(token, email),
  ]);

  // Upsert calendar events
  const upsertEvent = db.prepare(`
    INSERT INTO calendar_events (id, account_id, calendar_id, title, start_time, end_time,
      all_day, attendees, location, description, html_link, rsvp_status, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, start_time=excluded.start_time, end_time=excluded.end_time,
      all_day=excluded.all_day, attendees=excluded.attendees, location=excluded.location,
      description=excluded.description, html_link=excluded.html_link,
      rsvp_status=excluded.rsvp_status, synced_at=excluded.synced_at
  `);

  const deleteStaleEvents = db.prepare(
    "DELETE FROM calendar_events WHERE account_id = ? AND synced_at < ?",
  );

  db.transaction(() => {
    for (const event of events) {
      upsertEvent.run(
        event.id, accountId, event.calendar_id, event.title,
        event.start_time, event.end_time, event.all_day ? 1 : 0,
        JSON.stringify(event.attendees), event.location, event.description,
        event.html_link, event.rsvp_status, now,
      );
    }
    deleteStaleEvents.run(accountId, now);
  })();

  // Upsert emails

  const upsertEmail = db.prepare(`
    INSERT INTO email_cache (id, account_id, thread_id, subject, sender, date,
      labels, snippet, is_starred, is_important, html_link, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      subject=excluded.subject, sender=excluded.sender, date=excluded.date,
      labels=excluded.labels, snippet=excluded.snippet, is_starred=excluded.is_starred,
      is_important=excluded.is_important, html_link=excluded.html_link, synced_at=excluded.synced_at
  `);

  const pruneOldEmails = db.prepare(
    "DELETE FROM email_cache WHERE account_id = ? AND synced_at < ?",
  );

  db.transaction(() => {
    for (const msg of emails) {
      upsertEmail.run(
        msg.id, accountId, msg.thread_id, msg.subject, msg.sender, msg.date,
        JSON.stringify(msg.labels), msg.snippet, msg.is_starred ? 1 : 0,
        msg.is_important ? 1 : 0, msg.html_link, now,
      );
    }
    pruneOldEmails.run(accountId, now);
  })();

  // Update last_synced_at
  db.prepare("UPDATE external_accounts SET last_synced_at = ? WHERE id = ?").run(now, accountId);

  return { calendar_events_synced: events.length, emails_synced: emails.length };
}
