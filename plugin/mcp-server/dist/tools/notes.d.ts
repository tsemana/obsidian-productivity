/** note_read — read any vault file */
export declare function noteRead(vaultPath: string, path: string): {
    path: string;
    frontmatter: Record<string, unknown> | null;
    body: string;
    raw: string;
} | {
    error: string;
    path: string;
    message: string;
};
/** note_write — write a file to the vault */
export declare function noteWrite(vaultPath: string, path: string, options: {
    frontmatter?: Record<string, unknown>;
    body?: string;
    raw?: string;
    overwrite?: boolean;
}): {
    path: string;
    created: boolean;
} | {
    error: string;
    path: string;
    message: string;
};
/** note_search — search vault notes by content and/or frontmatter */
export declare function noteSearch(vaultPath: string, options: {
    query?: string;
    frontmatter_filter?: Record<string, unknown>;
    directory?: string;
    extension?: string;
    limit?: number;
}, db?: import("better-sqlite3").Database): {
    results: Array<{
        path: string;
        frontmatter?: Record<string, unknown>;
        matches?: Array<{
            line: number;
            text: string;
        }>;
    }>;
    count: number;
};
/** note_update — generic patch-style update for existing notes/files */
export declare function noteUpdate(vaultPath: string, path: string, options: {
    frontmatter?: Record<string, unknown>;
    append_body?: string;
    replace_section?: {
        heading: string;
        content: string;
    };
    body?: string;
    raw?: string;
}): {
    path: string;
    updated: boolean;
    frontmatter?: Record<string, unknown> | null;
} | {
    error: string;
    path: string;
    message: string;
};
/** note_move — move a file within the vault */
export declare function noteMove(vaultPath: string, fromPath: string, toPath: string): {
    from_path: string;
    to_path: string;
    moved: boolean;
} | {
    error: string;
    message: string;
};
//# sourceMappingURL=notes.d.ts.map