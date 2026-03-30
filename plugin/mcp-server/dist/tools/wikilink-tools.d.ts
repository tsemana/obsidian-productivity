import type { Database as DatabaseType } from "better-sqlite3";
/** wikilink_consolidate — rewrite all variant links to canonical format */
export declare function wikilinkConsolidate(vaultPath: string, name: string, dryRun?: boolean, db?: DatabaseType): {
    canonical: string;
    display_name: string;
    aliases: string[];
    files_scanned: number;
    links_updated: number;
    changed_files: Array<{
        path: string;
        count: number;
    }>;
} | {
    error: string;
    message: string;
};
type ValidateResult = {
    broken_links: Array<{
        source_path: string;
        link_text: string;
        suggestions: string[];
    }>;
    count: number;
};
/** wikilink_validate — find broken wikilinks in the vault */
export declare function wikilinkValidate(vaultPath: string, directory?: string, fixSuggestions?: boolean, db?: DatabaseType): ValidateResult;
export {};
//# sourceMappingURL=wikilink-tools.d.ts.map