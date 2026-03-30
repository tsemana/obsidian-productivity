// ─── Shared Types for MCP Tools ──────────────────────────────────────────
// Extracted to break the circular import between radar.ts and composite.ts.

/** Row shape for task notes queried from the notes table */
export interface TaskRow {
  path: string;
  title: string | null;
  priority: string | null;
  due: string | null;
  body_preview: string | null;
  frontmatter_json: string | null;
}

/** Row shape for calendar events joined with external_accounts */
export interface EventRow {
  id: string;
  account_id: string;
  calendar_id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  all_day: number;
  attendees: string | null;
  location: string | null;
  description: string | null;
  html_link: string | null;
  rsvp_status: string | null;
  account_email: string;
  context: string | null;
}

/** Row shape for email cache joined with external_accounts */
export interface EmailRow {
  id: string;
  account_id: string;
  thread_id: string;
  subject: string | null;
  sender: string | null;
  date: string | null;
  labels: string | null;
  snippet: string | null;
  is_starred: number;
  is_important: number;
  html_link: string | null;
  account_email: string;
  context: string | null;
}
