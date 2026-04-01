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
/** account_list — list all registered Google accounts with status */
export declare function accountList(db: DatabaseType): {
    accounts: Array<{
        id: string;
        email: string;
        context: string | null;
        has_refresh_token: boolean;
        last_synced_at: string | null;
    }>;
    total: number;
};
/** account_remove — remove an account and all its cached data */
export declare function accountRemove(db: DatabaseType, options: {
    id: string;
}): {
    id: string;
    email: string;
    removed: {
        calendar_events: number;
        emails: number;
    };
    message: string;
} | {
    error: string;
    message: string;
};
//# sourceMappingURL=external.d.ts.map