/** obsidian_config_read — read an Obsidian config file */
export declare function obsidianConfigRead(vaultPath: string, filename: string): {
    path: string;
    exists: boolean;
    content: Record<string, unknown> | null;
} | {
    error: string;
    message: string;
};
/** obsidian_config_write — write or update an Obsidian config file */
export declare function obsidianConfigWrite(vaultPath: string, filename: string, content: Record<string, unknown>, merge?: boolean): {
    path: string;
    created: boolean;
    merged: boolean;
} | {
    error: string;
    message: string;
};
//# sourceMappingURL=obsidian-config.d.ts.map