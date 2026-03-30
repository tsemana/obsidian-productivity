/**
 * Wikilink utilities for the Obsidian vault MCP server.
 * Handles extraction, validation, and canonical formatting of wikilinks.
 */
export interface Wikilink {
    /** Full match text including [[ and ]] */
    raw: string;
    /** Link target (filename or alias) */
    target: string;
    /** Display text after |, or null if none */
    display: string | null;
    /** Start index in the source string */
    index: number;
}
/**
 * Extract all wikilinks from a string.
 * Handles: [[target]], [[target|display]], [[target\|display]] (table-escaped pipe)
 */
export declare function extractWikilinks(content: string): Wikilink[];
/** Build a canonical wikilink string */
export declare function canonicalWikilink(filename: string, displayName: string): string;
/**
 * Build a regex pattern that matches wikilinks targeting any of the given aliases.
 * Aliases are sorted longest-first to avoid partial matches.
 * Port of consolidate.py's build_pattern().
 */
export declare function buildAliasPattern(aliases: string[]): RegExp;
/**
 * Rewrite all wikilinks in content that match any alias to the canonical format.
 * Returns the modified content and count of changes.
 * Port of consolidate.py's main rewrite logic.
 */
export declare function consolidateWikilinks(content: string, canonicalFilename: string, displayName: string, aliases: string[]): {
    content: string;
    changeCount: number;
};
//# sourceMappingURL=wikilinks.d.ts.map