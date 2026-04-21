import type { Database as DatabaseType } from "better-sqlite3";
/** Index a single file into the database (upsert) */
export declare function reindexFile(db: DatabaseType, vaultPath: string, filePath: string, preloaded?: {
    content: string;
    mtime: number;
}): void;
/** Full scan — index every .md file in the vault */
export declare function fullScan(db: DatabaseType, vaultPath: string): {
    indexed: number;
};
/** Incremental sync — only process new, modified, and deleted files */
export declare function incrementalSync(db: DatabaseType, vaultPath: string): {
    added: number;
    updated: number;
    deleted: number;
};
/** Run sync — full scan if DB is empty, incremental otherwise */
export declare function runSync(db: DatabaseType, vaultPath: string): {
    mode: "full" | "incremental";
    added: number;
    updated: number;
    deleted: number;
    indexed?: number;
};
//# sourceMappingURL=sync.d.ts.map