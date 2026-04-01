import { execFileSync } from "node:child_process";
import { refreshAccessToken } from "./google-oauth.js";
// ─── Token Acquisition ────────────────────────────────────────────────────
/**
 * Get an access token for a Google account.
 * Prefers OAuth2 refresh token if available and client credentials are set.
 * Falls back to gcloud CLI if not.
 */
export async function getAccessToken(db, accountId) {
    const account = db
        .prepare("SELECT account_email, refresh_token FROM external_accounts WHERE id = ?")
        .get(accountId);
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
        console.error(`Warning: Account "${accountId}" has a refresh token but GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set. Falling back to gcloud.`);
    }
    try {
        const token = execFileSync("gcloud", ["auth", "print-access-token", `--account=${account.account_email}`], { encoding: "utf-8", timeout: 15000 }).trim();
        if (!token)
            throw new Error(`Empty token returned for ${account.account_email}`);
        return token;
    }
    catch (e) {
        throw new Error(`Failed to get access token for ${account.account_email}. ` +
            `Either configure OAuth credentials in .env.schema (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET) ` +
            `or run: gcloud auth login ${account.account_email}\n${e}`);
    }
}
/** Fetch calendar events for an account */
export async function fetchCalendarEvents(token, options = {}) {
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
    const calendarsData = await calendarsRes.json();
    const calendarIds = (calendarsData.items ?? []).map((c) => c.id);
    const allEvents = [];
    for (const calendarId of calendarIds) {
        let pageToken;
        do {
            const params = new URLSearchParams({
                timeMin,
                timeMax,
                timeZone,
                singleEvents: "true",
                orderBy: "startTime",
                maxResults: "250",
            });
            if (pageToken)
                params.set("pageToken", pageToken);
            const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
            const eventsRes = await fetch(eventsUrl, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!eventsRes.ok) {
                // Skip calendars we can't read (permissions)
                break;
            }
            const eventsData = await eventsRes.json();
            for (const event of eventsData.items ?? []) {
                if (event.status === "cancelled")
                    continue;
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
/** Fetch email messages for an account */
export async function fetchEmails(token, accountEmail, options = {}) {
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
    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0) {
        return [];
    }
    // Fetch each message's details
    const messages = [];
    for (const msg of listData.messages) {
        const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
        const msgRes = await fetch(msgUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!msgRes.ok)
            continue;
        const msgData = await msgRes.json();
        const headers = msgData.payload?.headers ?? [];
        const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
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
export async function syncAccount(db, accountId, email, options = {}) {
    const token = await getAccessToken(db, accountId);
    const now = Date.now();
    // Sync calendar
    const events = await fetchCalendarEvents(token, { timeZone: options.timeZone });
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
    const deleteStaleEvents = db.prepare("DELETE FROM calendar_events WHERE account_id = ? AND synced_at < ?");
    db.transaction(() => {
        for (const event of events) {
            upsertEvent.run(event.id, accountId, event.calendar_id, event.title, event.start_time, event.end_time, event.all_day ? 1 : 0, JSON.stringify(event.attendees), event.location, event.description, event.html_link, event.rsvp_status, now);
        }
        // Remove events that weren't in this sync (cancelled/removed)
        deleteStaleEvents.run(accountId, now);
    })();
    // Sync email
    const emails = await fetchEmails(token, email);
    const upsertEmail = db.prepare(`
    INSERT INTO email_cache (id, account_id, thread_id, subject, sender, date,
      labels, snippet, is_starred, is_important, html_link, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      subject=excluded.subject, sender=excluded.sender, date=excluded.date,
      labels=excluded.labels, snippet=excluded.snippet, is_starred=excluded.is_starred,
      is_important=excluded.is_important, html_link=excluded.html_link, synced_at=excluded.synced_at
  `);
    const pruneOldEmails = db.prepare("DELETE FROM email_cache WHERE account_id = ? AND synced_at < ?");
    db.transaction(() => {
        for (const msg of emails) {
            upsertEmail.run(msg.id, accountId, msg.thread_id, msg.subject, msg.sender, msg.date, JSON.stringify(msg.labels), msg.snippet, msg.is_starred ? 1 : 0, msg.is_important ? 1 : 0, msg.html_link, now);
        }
        pruneOldEmails.run(accountId, now);
    })();
    // Update last_synced_at
    db.prepare("UPDATE external_accounts SET last_synced_at = ? WHERE id = ?").run(now, accountId);
    return { calendar_events_synced: events.length, emails_synced: emails.length };
}
//# sourceMappingURL=google-api.js.map