/** vault_init — create missing vault directories */
export declare function vaultInit(vaultPath: string, directories?: string[]): {
    created: string[];
    existed: string[];
    vault_path: string;
};
/** vault_health — check vault state */
export declare function vaultHealth(vaultPath: string): {
    has_obsidian_config: boolean;
    has_claude_md: boolean;
    directories: Record<string, {
        exists: boolean;
        file_count: number;
    }>;
    total_notes: number;
};
export interface VaultListFile {
    name: string;
    path: string;
    frontmatter?: Record<string, unknown>;
}
/** vault_list — list files in a vault directory */
export declare function vaultList(vaultPath: string, directory: string, options?: {
    include_frontmatter?: boolean;
    recursive?: boolean;
    extension?: string;
}): {
    directory: string;
    files: VaultListFile[];
};
//# sourceMappingURL=vault-management.d.ts.map