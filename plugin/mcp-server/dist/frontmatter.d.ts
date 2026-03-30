export interface ParsedNote {
    frontmatter: Record<string, unknown> | null;
    body: string;
    raw: string;
}
/** Parse a markdown file's content into frontmatter and body */
export declare function parseNote(content: string): ParsedNote;
/** Serialize frontmatter and body back to a markdown string */
export declare function serializeNote(frontmatter: Record<string, unknown> | null, body: string): string;
/** Merge new frontmatter fields into existing frontmatter */
export declare function mergeFrontmatter(existing: Record<string, unknown> | null, updates: Record<string, unknown>): Record<string, unknown>;
/**
 * Replace a section in markdown body by heading.
 * Matches ## heading and replaces content up to the next heading of equal or higher level, or EOF.
 * If the heading doesn't exist, appends the section at the end.
 */
export declare function replaceSection(body: string, heading: string, newContent: string): string;
/**
 * Check if a note's frontmatter matches a set of filter criteria.
 * Supports simple equality, array containment, and substring matching.
 */
export declare function matchesFrontmatter(frontmatter: Record<string, unknown> | null, filter: Record<string, unknown>): boolean;
//# sourceMappingURL=frontmatter.d.ts.map