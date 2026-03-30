import type { Database as DatabaseType } from "better-sqlite3";
interface MemoryMatch {
    path: string;
    frontmatter: Record<string, unknown>;
    match_reason: string;
}
/** memory_read — read a memory file by path or search by name/alias */
export declare function memoryRead(vaultPath: string, options: {
    path?: string;
    search?: string;
    type?: "person" | "project" | "glossary" | "context" | "any";
}, db?: DatabaseType): {
    path: string;
    frontmatter: Record<string, unknown> | null;
    body: string;
} | {
    matches: MemoryMatch[];
} | {
    error: string;
    message: string;
};
/** memory_write — create or update a memory file */
export declare function memoryWrite(vaultPath: string, path: string, options: {
    frontmatter?: Record<string, unknown>;
    body?: string;
    append_body?: string;
    replace_section?: {
        heading: string;
        content: string;
    };
    create_only?: boolean;
}, db?: DatabaseType): {
    path: string;
    created: boolean;
    frontmatter: Record<string, unknown>;
} | {
    error: string;
    message: string;
};
/** claudemd_read — read CLAUDE.md */
export declare function claudemdRead(vaultPath: string): {
    exists: boolean;
    content: string;
};
/** claudemd_update — update CLAUDE.md */
export declare function claudemdUpdate(vaultPath: string, options: {
    content?: string;
    replace_section?: {
        heading: string;
        content: string;
    };
    append?: string;
}): {
    path: string;
    updated: boolean;
} | {
    error: string;
    message: string;
};
export {};
//# sourceMappingURL=memory.d.ts.map