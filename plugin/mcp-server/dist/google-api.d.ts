import type { Database as DatabaseType } from "better-sqlite3";
/**
 * Get an access token for a Google account.
 * Prefers OAuth2 refresh token if available and client credentials are set.
 * Falls back to gcloud CLI if not.
 */
export declare function getAccessToken(db: DatabaseType, accountId: string): Promise<string>;
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
export declare function fetchCalendarEvents(token: string, options?: {
    timeMin?: string;
    timeMax?: string;
    timeZone?: string;
}): Promise<CalendarEvent[]>;
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
export declare function fetchEmails(token: string, accountEmail: string, options?: {
    query?: string;
    maxResults?: number;
}): Promise<EmailMessage[]>;
/** Sync a single account's calendar and email data into SQLite cache */
export declare function syncAccount(db: DatabaseType, accountId: string, email: string, options?: {
    timeZone?: string;
}): Promise<{
    calendar_events_synced: number;
    emails_synced: number;
}>;
export {};
//# sourceMappingURL=google-api.d.ts.map