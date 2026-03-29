import matter from "gray-matter";

export interface ParsedNote {
  frontmatter: Record<string, unknown> | null;
  body: string;
  raw: string;
}

/** Parse a markdown file's content into frontmatter and body */
export function parseNote(content: string): ParsedNote {
  try {
    const result = matter(content);
    const fm =
      result.data && Object.keys(result.data).length > 0
        ? result.data
        : null;
    return {
      frontmatter: fm,
      body: result.content,
      raw: content,
    };
  } catch {
    // If frontmatter parsing fails, treat entire content as body
    return {
      frontmatter: null,
      body: content,
      raw: content,
    };
  }
}

/** Serialize frontmatter and body back to a markdown string */
export function serializeNote(
  frontmatter: Record<string, unknown> | null,
  body: string,
): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return body;
  }
  return matter.stringify(body, frontmatter);
}

/** Merge new frontmatter fields into existing frontmatter */
export function mergeFrontmatter(
  existing: Record<string, unknown> | null,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(existing || {}), ...updates };
}

/**
 * Replace a section in markdown body by heading.
 * Matches ## heading and replaces content up to the next heading of equal or higher level, or EOF.
 * If the heading doesn't exist, appends the section at the end.
 */
export function replaceSection(
  body: string,
  heading: string,
  newContent: string,
): string {
  // Match ## heading (with optional whitespace)
  const headingLevel = heading.startsWith("#")
    ? heading.match(/^#+/)?.[0].length ?? 2
    : 2;
  const headingPrefix = "#".repeat(headingLevel);

  // Normalize: if heading already starts with #, use as-is; otherwise prepend ##
  const fullHeading = heading.startsWith("#")
    ? heading
    : `${headingPrefix} ${heading}`;

  const headingRegex = new RegExp(
    `^${escapeRegex(fullHeading)}\\s*$`,
    "m",
  );
  const match = headingRegex.exec(body);

  if (!match) {
    // Heading not found — append
    const trimmed = body.trimEnd();
    return `${trimmed}\n\n${fullHeading}\n${newContent}\n`;
  }

  const startIndex = match.index;
  const afterHeading = startIndex + match[0].length;

  // Find the next heading of equal or higher level
  const nextHeadingRegex = new RegExp(
    `^#{1,${headingLevel}} `,
    "m",
  );
  const rest = body.slice(afterHeading);
  const nextMatch = nextHeadingRegex.exec(rest);

  const endIndex = nextMatch
    ? afterHeading + nextMatch.index
    : body.length;

  const before = body.slice(0, startIndex);
  const after = body.slice(endIndex);

  return `${before}${fullHeading}\n${newContent}\n${after}`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check if a note's frontmatter matches a set of filter criteria.
 * Supports simple equality, array containment, and substring matching.
 */
export function matchesFrontmatter(
  frontmatter: Record<string, unknown> | null,
  filter: Record<string, unknown>,
): boolean {
  if (!frontmatter) return false;

  for (const [key, expected] of Object.entries(filter)) {
    const actual = frontmatter[key];
    if (actual === undefined) return false;

    if (Array.isArray(actual)) {
      // Array field: check if expected value is contained
      if (Array.isArray(expected)) {
        // Both arrays: check intersection
        if (!expected.some((v) => actual.includes(v))) return false;
      } else {
        if (!actual.includes(expected)) return false;
      }
    } else if (typeof actual === "string" && typeof expected === "string") {
      // String: exact match or substring for wikilinks
      if (actual !== expected && !actual.includes(expected)) return false;
    } else {
      // Direct equality
      if (actual !== expected) return false;
    }
  }
  return true;
}
