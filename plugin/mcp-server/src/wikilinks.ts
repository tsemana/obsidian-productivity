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
export function extractWikilinks(content: string): Wikilink[] {
  const regex = /\[\[([^\]\n|\\]+)(\\?\|([^\]\n]+))?\]\]/g;
  const links: Wikilink[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    links.push({
      raw: match[0],
      target: match[1].trim(),
      display: match[3]?.trim() ?? null,
      index: match.index,
    });
  }

  return links;
}

/** Build a canonical wikilink string */
export function canonicalWikilink(
  filename: string,
  displayName: string,
): string {
  return `[[${filename}|${displayName}]]`;
}

/**
 * Build a regex pattern that matches wikilinks targeting any of the given aliases.
 * Aliases are sorted longest-first to avoid partial matches.
 * Port of consolidate.py's build_pattern().
 */
export function buildAliasPattern(aliases: string[]): RegExp {
  const sorted = [...aliases].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(escapeRegex);
  const aliasGroup = escaped.join("|");
  // Capture groups:
  //   1 — the matched alias (link target)
  //   2 — everything after target: empty, |display, or \|display
  return new RegExp(`\\[\\[(${aliasGroup})((?:\\\\?\\|[^\\]\\n]+)?)\\]\\]`, "g");
}

/**
 * Rewrite all wikilinks in content that match any alias to the canonical format.
 * Returns the modified content and count of changes.
 * Port of consolidate.py's main rewrite logic.
 */
export function consolidateWikilinks(
  content: string,
  canonicalFilename: string,
  displayName: string,
  aliases: string[],
): { content: string; changeCount: number } {
  // Exclude the canonical filename from aliases to avoid matching already-correct links
  const aliasesToMatch = aliases.filter((a) => a !== canonicalFilename);
  if (aliasesToMatch.length === 0) {
    return { content, changeCount: 0 };
  }

  const pattern = buildAliasPattern(aliasesToMatch);
  let changeCount = 0;

  const modified = content.replace(pattern, (_match, alias, suffix) => {
    // Already canonical — leave it alone
    if (alias === canonicalFilename) {
      return _match;
    }

    changeCount++;

    if (suffix) {
      // Keep existing display text, just fix the filename
      return `[[${canonicalFilename}${suffix}]]`;
    } else {
      // No display text — use the canonical display name
      return `[[${canonicalFilename}|${displayName}]]`;
    }
  });

  return { content: modified, changeCount };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
