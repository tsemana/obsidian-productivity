import type { Database as DatabaseType } from "better-sqlite3";
/** task_create — create a new task note */
export declare function taskCreate(vaultPath: string, options: {
    title: string;
    status?: string;
    priority?: string;
    due?: string;
    context?: string;
    assigned_to?: string;
    project?: string;
    waiting_on?: string;
    body?: string;
    filename?: string;
}, db?: DatabaseType): {
    path: string;
    frontmatter: Record<string, unknown>;
} | {
    error: string;
    message: string;
};
/** task_update — update an existing task note */
export declare function taskUpdate(vaultPath: string, path: string, options: {
    frontmatter?: Record<string, unknown>;
    append_body?: string;
    replace_section?: {
        heading: string;
        content: string;
    };
}, db?: DatabaseType): {
    path: string;
    frontmatter: Record<string, unknown>;
} | {
    error: string;
    path: string;
    message: string;
};
/** task_complete — mark task done and move to tasks/done/ */
export declare function taskComplete(vaultPath: string, path: string, db?: DatabaseType): {
    old_path: string;
    new_path: string;
    completed: string;
} | {
    error: string;
    message: string;
};
/** task_list — dispatcher: use SQLite index if available, fall back to file scan */
export declare function taskList(vaultPath: string, options?: {
    status?: string | string[];
    priority?: string | string[];
    context?: string;
    project?: string;
    due_before?: string;
    due_after?: string;
    include_done?: boolean;
    assigned_to?: string;
}, db?: DatabaseType): {
    tasks: Array<{
        path: string;
        frontmatter: Record<string, unknown>;
        body_preview: string;
    }>;
    count: number;
};
//# sourceMappingURL=tasks.d.ts.map