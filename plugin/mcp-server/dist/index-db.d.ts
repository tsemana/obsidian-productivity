import type { Database as DatabaseType } from "better-sqlite3";
/** Open or create the SQLite database for the given vault */
export declare function openDatabase(vaultPath: string): DatabaseType;
/** Get the current database connection (must call openDatabase first) */
export declare function getDatabase(): DatabaseType | null;
/** Close the database connection */
export declare function closeDatabase(): void;
//# sourceMappingURL=index-db.d.ts.map