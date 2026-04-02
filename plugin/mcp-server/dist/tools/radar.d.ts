import type { Database as DatabaseType } from "better-sqlite3";
export type { TaskRow, EventRow, EmailRow } from "./types.js";
/** radar_generate — sync accounts, query all data, render radar HTML and daily note */
export declare function radarGenerate(db: DatabaseType, vaultPath: string, options?: {
    date?: string;
    sidecarPort?: number;
}): Promise<{
    path: string;
    daily_note_path: string;
    tasks_count: number;
    events_count: number;
    emails_count: number;
} | {
    error: string;
    message: string;
}>;
/** radar_update_item — modify a single item's visual state in the radar HTML */
export declare function radarUpdateItem(vaultPath: string, options: {
    path?: string;
    email_id?: string;
    state: "resolved" | "active";
    date?: string;
    explanation?: string;
}): {
    path?: string;
    email_id?: string;
    state: string;
    updated: boolean;
} | {
    error: string;
    message: string;
};
//# sourceMappingURL=radar.d.ts.map