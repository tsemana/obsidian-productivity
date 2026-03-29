import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { parseNote, serializeNote, mergeFrontmatter, replaceSection, matchesFrontmatter } from "../frontmatter.js";
import { isInsideVault, pathExists, isFile } from "../vault.js";
import { vaultList } from "./vault-management.js";

/** note_read — read any vault file */
export function noteRead(
  vaultPath: string,
  path: string,
): { path: string; frontmatter: Record<string, unknown> | null; body: string; raw: string } | { error: string; path: string; message: string } {
  if (!isInsideVault(vaultPath, path)) {
    return { error: "path_traversal", path, message: "Path escapes vault boundary" };
  }

  const fullPath = join(vaultPath, path);
  if (!existsSync(fullPath)) {
    return { error: "file_not_found", path, message: `File not found: ${path}` };
  }

  try {
    const content = readFileSync(fullPath, "utf-8");
    if (path.endsWith(".md")) {
      const parsed = parseNote(content);
      return { path, frontmatter: parsed.frontmatter, body: parsed.body, raw: parsed.raw };
    }
    return { path, frontmatter: null, body: content, raw: content };
  } catch (e) {
    return { error: "read_error", path, message: String(e) };
  }
}

/** note_write — write a file to the vault */
export function noteWrite(
  vaultPath: string,
  path: string,
  options: {
    frontmatter?: Record<string, unknown>;
    body?: string;
    raw?: string;
    overwrite?: boolean;
  },
): { path: string; created: boolean } | { error: string; path: string; message: string } {
  if (!isInsideVault(vaultPath, path)) {
    return { error: "path_traversal", path, message: "Path escapes vault boundary" };
  }

  const fullPath = join(vaultPath, path);
  const exists = existsSync(fullPath);

  if (exists && options.overwrite === false) {
    return { error: "file_exists", path, message: `File already exists: ${path}` };
  }

  // Ensure parent directory exists
  const parentDir = dirname(fullPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  let content: string;
  if (options.raw !== undefined) {
    content = options.raw;
  } else {
    content = serializeNote(options.frontmatter ?? null, options.body ?? "");
  }

  // Atomic write: write to temp, then rename
  const tmpPath = fullPath + ".tmp";
  try {
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, fullPath);
  } catch (e) {
    // Clean up temp file on failure
    try { if (existsSync(tmpPath)) writeFileSync(tmpPath, "", "utf-8"); } catch {}
    return { error: "write_error", path, message: String(e) };
  }

  return { path, created: !exists };
}

/** note_search — search vault notes by content and/or frontmatter */
export function noteSearch(
  vaultPath: string,
  options: {
    query?: string;
    frontmatter_filter?: Record<string, unknown>;
    directory?: string;
    extension?: string;
    limit?: number;
  },
): { results: Array<{ path: string; frontmatter?: Record<string, unknown>; matches?: Array<{ line: number; text: string }> }>; count: number } {
  const { query, frontmatter_filter, directory, extension = ".md", limit = 50 } = options;
  const searchDir = directory ?? ".";

  const listing = vaultList(vaultPath, searchDir, {
    include_frontmatter: !!frontmatter_filter,
    recursive: true,
    extension,
  });

  const results: Array<{ path: string; frontmatter?: Record<string, unknown>; matches?: Array<{ line: number; text: string }> }> = [];

  for (const file of listing.files) {
    if (results.length >= limit) break;

    // Frontmatter filter
    if (frontmatter_filter) {
      if (!file.frontmatter || !matchesFrontmatter(file.frontmatter, frontmatter_filter)) {
        continue;
      }
    }

    // Text search
    if (query) {
      try {
        const content = readFileSync(join(vaultPath, file.path), "utf-8");
        const queryLower = query.toLowerCase();
        const lines = content.split("\n");
        const matches: Array<{ line: number; text: string }> = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(queryLower)) {
            matches.push({ line: i + 1, text: lines[i].trim() });
          }
        }

        if (matches.length === 0) continue;

        const result: { path: string; frontmatter?: Record<string, unknown>; matches: Array<{ line: number; text: string }> } = {
          path: file.path,
          matches: matches.slice(0, 5), // Limit context lines per file
        };
        if (file.frontmatter) result.frontmatter = file.frontmatter;
        results.push(result);
      } catch {
        continue;
      }
    } else {
      // Frontmatter-only match
      const result: { path: string; frontmatter?: Record<string, unknown> } = { path: file.path };
      if (file.frontmatter) result.frontmatter = file.frontmatter;
      results.push(result);
    }
  }

  return { results, count: results.length };
}

/** note_move — move a file within the vault */
export function noteMove(
  vaultPath: string,
  fromPath: string,
  toPath: string,
): { from_path: string; to_path: string; moved: boolean } | { error: string; message: string } {
  if (!isInsideVault(vaultPath, fromPath) || !isInsideVault(vaultPath, toPath)) {
    return { error: "path_traversal", message: "Path escapes vault boundary" };
  }

  const fullFrom = join(vaultPath, fromPath);
  const fullTo = join(vaultPath, toPath);

  if (!existsSync(fullFrom)) {
    return { error: "file_not_found", message: `Source not found: ${fromPath}` };
  }

  // Ensure target directory exists
  const parentDir = dirname(fullTo);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  try {
    renameSync(fullFrom, fullTo);
    return { from_path: fromPath, to_path: toPath, moved: true };
  } catch (e) {
    return { error: "move_error", message: String(e) };
  }
}
