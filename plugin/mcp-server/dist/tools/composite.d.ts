import type { Database as DatabaseType } from "better-sqlite3";
import type { TaskRow, EventRow, EmailRow } from "./types.js";
export interface TaskWithNextAction extends TaskRow {
    next_action: string | null;
}
export interface WaitingTask extends TaskRow {
    days_waiting: number;
    waiting_on: string | null;
    upcoming_meeting: string | null;
}
export interface ProjectNextAction {
    project_path: string;
    project_title: string | null;
    task_path: string | null;
    task_title: string | null;
    next_action: string | null;
}
export interface StuckProject {
    path: string;
    title: string | null;
    active_task_count: number;
}
export interface RadarDataResult {
    date: string;
    vault: {
        tasks: {
            overdue: TaskWithNextAction[];
            active: TaskWithNextAction[];
            waiting: WaitingTask[];
        };
        next_actions_by_project: ProjectNextAction[];
        inbox_count: number;
        stuck_projects: StuckProject[];
    };
    calendar: EventRow[];
    email: EmailRow[];
    memory_context: string;
    sources_available: {
        vault: boolean;
        calendar: boolean;
        email: boolean;
    };
}
export interface InboxItem {
    path: string;
    title: string | null;
    captured: string | null;
    hint: string | null;
    body_preview: string | null;
}
export interface ProjectSummary {
    project_path: string;
    project_title: string | null;
    active_task_count: number;
    waiting_task_count: number;
    has_next_action: boolean;
    last_activity: string | null;
}
export interface ReferenceFrequency {
    path: string;
    count: number;
}
export interface WeeklyReviewResult {
    date: string;
    inbox: {
        items: InboxItem[];
        count: number;
    };
    active_tasks: {
        items: TaskWithNextAction[];
        count: number;
    };
    waiting_tasks: {
        items: WaitingTask[];
        count: number;
    };
    projects: {
        active: ProjectSummary[];
        stuck: StuckProject[];
        count: number;
    };
    someday: {
        items: TaskWithNextAction[];
        count: number;
    };
    calendar_ahead: EventRow[];
    calendar_behind: EventRow[];
    memory: {
        claudemd: string;
        reference_frequency: ReferenceFrequency[];
    };
}
export interface PersonRef {
    path: string;
    name: string | null;
    role: string | null;
}
export interface FtsMatch {
    path: string;
    title: string | null;
    snippet: string | null;
    rank: number;
}
export interface WikilinkConnection {
    source_path: string;
    target_slug: string;
    display_text: string | null;
}
export interface ProjectOverviewResult {
    project: {
        path: string;
        frontmatter: Record<string, unknown> | null;
        body: string;
    };
    tasks: {
        active: TaskWithNextAction[];
        waiting: WaitingTask[];
        completed_recent: TaskRow[];
        count: number;
    };
    people: PersonRef[];
    recent_mentions: FtsMatch[];
    wikilink_connections: WikilinkConnection[];
}
export interface SuggestedLink {
    path: string;
    title: string | null;
    relevance_snippet: string | null;
}
export interface QuickCaptureResult {
    path: string;
    hint: string | null;
    suggested_links: SuggestedLink[];
    message: string;
}
export interface SearchHit {
    path: string;
    title: string | null;
    snippet: string | null;
    rank: number;
    frontmatter: Record<string, unknown> | null;
}
export interface SearchResult {
    query: string;
    directory: string | null;
    count: number;
    results: SearchHit[];
}
export declare function radarData(db: DatabaseType, vaultPath: string, options?: {
    date?: string;
    lookahead_days?: number;
    include_email?: boolean;
    include_calendar?: boolean;
}): Promise<RadarDataResult>;
export declare function weeklyReview(db: DatabaseType, vaultPath: string): Promise<WeeklyReviewResult>;
export declare function projectOverview(db: DatabaseType, vaultPath: string, options: {
    project: string;
}): Promise<ProjectOverviewResult | {
    error: string;
    message: string;
}>;
export declare function quickCapture(db: DatabaseType, vaultPath: string, options: {
    thought: string;
    hint?: string;
}): Promise<QuickCaptureResult>;
export declare function searchAndSummarize(db: DatabaseType, vaultPath: string, options: {
    query: string;
    directory?: string;
    limit?: number;
}): Promise<SearchResult>;
//# sourceMappingURL=composite.d.ts.map