import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { consolidateWikilinks, extractWikilinks } from "../wikilinks.js";
import { parseNote } from "../frontmatter.js";
import { vaultList } from "./vault-management.js";
import { memoryRead } from "./memory.js";
import type { Database as DatabaseType } from "better-sqlite3";
import { incrementalSync } from "../sync.js";

/** Recursively collect all .md files in the vault, skipping .obsidian */
function allMdFiles(dirPath: string, vaultPath: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(relative(vaultPath, fullPath));
      }
    }
  }

  walk(dirPath);
  return results;
}

/** wikilink_consolidate — rewrite all variant links to canonical format */
export function wikilinkConsolidate(
  vaultPath: string,
  name: string,
  dryRun: boolean = false,
  db?: DatabaseType,
): {
  canonical: string;
  display_name: string;
  aliases: string[];
  files_scanned: number;
  links_updated: number;
  changed_files: Array<{ path: string; count: number }>;
} | { error: string; message: string } {
  // Find the target note
  const searchResult = memoryRead(vaultPath, { search: name, type: "any" });

  if ("error" in searchResult) return searchResult;

  let targetPath: string;
  let targetFm: Record<string, unknown>;

  if ("matches" in searchResult) {
    if (searchResult.matches.length === 0) {
      return { error: "not_found", message: `No note found matching: ${name}` };
    }
    if (searchResult.matches.length > 1) {
      return {
        error: "ambiguous",
        message: `Multiple notes match "${name}": ${searchResult.matches.map((m) => m.path).join(", ")}. Please be more specific.`,
      };
    }
    targetPath = searchResult.matches[0].path;
    targetFm = searchResult.matches[0].frontmatter;
  } else {
    targetPath = searchResult.path;
    targetFm = searchResult.frontmatter ?? {};
  }

  // Extract canonical filename (without .md and path prefix)
  const filename = targetPath.split("/").pop()?.replace(".md", "") ?? "";
  const displayName = (targetFm.title as string) ?? filename;
  const aliases: string[] = [
    displayName,
    filename,
    ...((targetFm.aliases as string[]) ?? []),
  ];
  // Deduplicate
  const uniqueAliases = [...new Set(aliases)];

  // Scan all vault .md files
  const allFiles = allMdFiles(vaultPath, vaultPath);
  let totalLinksUpdated = 0;
  const changedFiles: Array<{ path: string; count: number }> = [];

  for (const relPath of allFiles) {
    const fullPath = join(vaultPath, relPath);
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const { content: modified, changeCount } = consolidateWikilinks(
      content,
      filename,
      displayName,
      uniqueAliases,
    );

    if (changeCount === 0) continue;

    totalLinksUpdated += changeCount;
    changedFiles.push({ path: relPath, count: changeCount });

    if (!dryRun) {
      try {
        writeFileSync(fullPath, modified, "utf-8");
      } catch {
        // Skip files that can't be written
      }
    }
  }

  if (!dryRun && db) {
    incrementalSync(db, vaultPath);
  }

  return {
    canonical: filename,
    display_name: displayName,
    aliases: uniqueAliases,
    files_scanned: allFiles.length,
    links_updated: totalLinksUpdated,
    changed_files: changedFiles,
  };
}

type ValidateResult = {
  broken_links: Array<{
    source_path: string;
    link_text: string;
    suggestions: string[];
  }>;
  count: number;
};

/** wikilink_validate (indexed) — find broken wikilinks using SQLite index */
function wikilinkValidateIndexed(
  db: DatabaseType,
  directory: string | undefined,
  fixSuggestions: boolean,
): ValidateResult {
  // Build known targets from the notes table
  const knownTargets = new Map<string, string>(); // lowercase target → path

  const noteRows = db
    .prepare("SELECT path, title, frontmatter_json FROM notes")
    .all() as Array<{ path: string; title: string | null; frontmatter_json: string | null }>;

  for (const row of noteRows) {
    const name = row.path.split("/").pop()?.replace(".md", "") ?? "";
    knownTargets.set(name.toLowerCase(), row.path);

    if (row.title) {
      knownTargets.set(row.title.toLowerCase(), row.path);
    }

    if (row.frontmatter_json) {
      try {
        const fm = JSON.parse(row.frontmatter_json) as Record<string, unknown>;
        if (Array.isArray(fm.aliases)) {
          for (const alias of fm.aliases) {
            if (typeof alias === "string") {
              knownTargets.set(alias.toLowerCase(), row.path);
            }
          }
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }

  // Get wikilinks, optionally filtered by directory
  let wikilinkRows: Array<{ source_path: string; target_slug: string; display_text: string | null }>;

  if (directory && directory !== ".") {
    wikilinkRows = db
      .prepare(
        "SELECT source_path, target_slug, display_text FROM wikilinks WHERE source_path LIKE ?",
      )
      .all(`${directory}/%`) as typeof wikilinkRows;
  } else {
    wikilinkRows = db
      .prepare("SELECT source_path, target_slug, display_text FROM wikilinks")
      .all() as typeof wikilinkRows;
  }

  const brokenLinks: ValidateResult["broken_links"] = [];

  for (const row of wikilinkRows) {
    const target = row.target_slug.toLowerCase();
    if (target.startsWith("#")) continue;
    const baseTarget = target.split("#")[0].trim();
    if (!baseTarget) continue;

    if (!knownTargets.has(baseTarget)) {
      const suggestions: string[] = [];
      if (fixSuggestions) {
        for (const [known, kPath] of knownTargets) {
          if (known.includes(baseTarget) || baseTarget.includes(known)) {
            suggestions.push(kPath);
            if (suggestions.length >= 3) break;
          }
        }
      }

      // Reconstruct link_text from target_slug and display_text
      const link_text = row.display_text
        ? `[[${row.target_slug}|${row.display_text}]]`
        : `[[${row.target_slug}]]`;

      brokenLinks.push({
        source_path: row.source_path,
        link_text,
        suggestions,
      });
    }
  }

  return { broken_links: brokenLinks, count: brokenLinks.length };
}

/** wikilink_validate (file scan) — find broken wikilinks by scanning files */
function wikilinkValidateFileScan(
  vaultPath: string,
  directory: string | undefined,
  fixSuggestions: boolean,
): ValidateResult {
  const searchDir = directory ?? ".";
  const allFiles = allMdFiles(
    join(vaultPath, searchDir === "." ? "" : searchDir),
    vaultPath,
  );

  // Build a set of all known targets (filenames without .md, plus aliases)
  const knownTargets = new Map<string, string>(); // lowercase target → file path

  const allVaultFiles = allMdFiles(vaultPath, vaultPath);
  for (const filePath of allVaultFiles) {
    const name = filePath.split("/").pop()?.replace(".md", "") ?? "";
    knownTargets.set(name.toLowerCase(), filePath);

    // Also read aliases from frontmatter
    try {
      const content = readFileSync(join(vaultPath, filePath), "utf-8");
      const parsed = parseNote(content);
      if (parsed.frontmatter?.aliases && Array.isArray(parsed.frontmatter.aliases)) {
        for (const alias of parsed.frontmatter.aliases) {
          if (typeof alias === "string") {
            knownTargets.set(alias.toLowerCase(), filePath);
          }
        }
      }
      if (parsed.frontmatter?.title && typeof parsed.frontmatter.title === "string") {
        knownTargets.set((parsed.frontmatter.title as string).toLowerCase(), filePath);
      }
    } catch {
      // Skip unreadable files
    }
  }

  const brokenLinks: ValidateResult["broken_links"] = [];

  for (const filePath of allFiles) {
    let content: string;
    try {
      content = readFileSync(join(vaultPath, filePath), "utf-8");
    } catch {
      continue;
    }

    const links = extractWikilinks(content);
    for (const link of links) {
      const target = link.target.toLowerCase();
      // Skip headings-only links (starts with #)
      if (target.startsWith("#")) continue;
      // Strip heading suffix for lookup
      const baseTarget = target.split("#")[0].trim();
      if (!baseTarget) continue;

      if (!knownTargets.has(baseTarget)) {
        const suggestions: string[] = [];
        if (fixSuggestions) {
          // Simple fuzzy: find targets containing the search term
          for (const [known, kPath] of knownTargets) {
            if (known.includes(baseTarget) || baseTarget.includes(known)) {
              suggestions.push(kPath);
              if (suggestions.length >= 3) break;
            }
          }
        }

        brokenLinks.push({
          source_path: filePath,
          link_text: link.raw,
          suggestions,
        });
      }
    }
  }

  return { broken_links: brokenLinks, count: brokenLinks.length };
}

/** wikilink_validate — find broken wikilinks in the vault */
export function wikilinkValidate(
  vaultPath: string,
  directory?: string,
  fixSuggestions: boolean = true,
  db?: DatabaseType,
): ValidateResult {
  if (db) {
    return wikilinkValidateIndexed(db, directory, fixSuggestions);
  }
  return wikilinkValidateFileScan(vaultPath, directory, fixSuggestions);
}
