import type { Database as DatabaseType } from "better-sqlite3";
/** account_register — register a Google account for syncing */
export declare function accountRegister(db: DatabaseType, options: {
    id: string;
    email: string;
    context?: string;
}): Promise<{
    id: string;
    email: string;
    context: string | null;
    message: string;
} | {
    error: string;
    message: string;
}>;
/** account_sync — sync calendar and email data for one or all accounts */
export declare function accountSync(db: DatabaseType, options?: {
    id?: string;
    timeZone?: string;
}): Promise<{
    accounts: Array<{
        id: string;
        email: string;
        calendar_events_synced: number;
        emails_synced: number;
        error?: string;
    }>;
}>;
//# sourceMappingURL=external.d.ts.map