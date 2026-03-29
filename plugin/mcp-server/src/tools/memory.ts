import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseNote, serializeNote, mergeFrontmatter, replaceSection } from "../frontmatter.js";
import { noteRead, noteWrite } from "./notes.js";
import { vaultList } from "./vault-management.js";
import { isInsideVault } from "../vault.js";

interface MemoryMatch {
  path: string;
  frontmatter: Record<string, unknown>;
  match_reason: string;
}

/** memory_read — read a memory file by path or search by name/alias */
export function memoryRead(
  vaultPath: string,
  options: {
    path?: string;
    search?: string;
    type?: "person" | "project" | "glossary" | "context" | "any";
  },
): { path: string; frontmatter: Record<string, unknown> | null; body: string } | { matches: MemoryMatch[] } | { error: string; message: string } {
  // Direct path access
  if (options.path) {
    const result = noteRead(vaultPath, options.path);
    if ("error" in result) return result;
    return { path: result.path, frontmatter: result.frontmatter, body: result.body };
  }

  // Search mode
  if (!options.search) {
    return { error: "invalid_params", message: "Either path or search must be provided" };
  }

  const searchTerm = options.search.toLowerCase();
  const type = options.type ?? "any";
  const matches: MemoryMatch[] = [];

  // Determine which directories to search
  const searchDirs: Array<{ dir: string; typeLabel: string }> = [];
  if (type === "person" || type === "any") {
    searchDirs.push({ dir: "memory/people", typeLabel: "person" });
  }
  if (type === "project" || type === "any") {
    searchDirs.push({ dir: "memory/projects", typeLabel: "project" });
  }
  if (type === "glossary" || type === "any") {
    // Glossary is a single file — search within it
    const glossaryResult = searchGlossary(vaultPath, searchTerm);
    if (glossaryResult) {
      matches.push(glossaryResult);
    }
  }
  if (type === "context" || type === "any") {
    // Check context files
    const contextDir = "memory/context";
    const listing = vaultList(vaultPath, contextDir, {
      include_frontmatter: true,
      recursive: false,
      extension: ".md",
    });
    for (const file of listing.files) {
      if (matchesSearch(file, searchTerm)) {
        matches.push({
          path: file.path,
          frontmatter: file.frontmatter ?? {},
          match_reason: `context file: ${file.name}`,
        });
      }
    }
  }

  // Search people/project directories
  for (const { dir, typeLabel } of searchDirs) {
    const listing = vaultList(vaultPath, dir, {
      include_frontmatter: true,
      recursive: false,
      extension: ".md",
    });

    for (const file of listing.files) {
      const reason = matchesSearch(file, searchTerm);
      if (reason) {
        matches.push({
          path: file.path,
          frontmatter: file.frontmatter ?? {},
          match_reason: `${typeLabel}: ${reason}`,
        });
      }
    }
  }

  // If exactly one match, return the full content
  if (matches.length === 1) {
    const result = noteRead(vaultPath, matches[0].path);
    if ("error" in result) return result;
    return { path: result.path, frontmatter: result.frontmatter, body: result.body };
  }

  return { matches };
}

function matchesSearch(
  file: { name: string; path: string; frontmatter?: Record<string, unknown> },
  searchTerm: string,
): string | null {
  // Match filename
  if (file.name.toLowerCase().replace(".md", "").includes(searchTerm)) {
    return `filename match: ${file.name}`;
  }

  if (!file.frontmatter) return null;

  // Match title
  const title = file.frontmatter.title;
  if (typeof title === "string" && title.toLowerCase().includes(searchTerm)) {
    return `title match: ${title}`;
  }

  // Match aliases
  const aliases = file.frontmatter.aliases;
  if (Array.isArray(aliases)) {
    for (const alias of aliases) {
      if (typeof alias === "string" && alias.toLowerCase().includes(searchTerm)) {
        return `alias match: ${alias}`;
      }
    }
  }

  return null;
}

function searchGlossary(vaultPath: string, searchTerm: string): MemoryMatch | null {
  const glossaryPath = "memory/glossary.md";
  if (!existsSync(join(vaultPath, glossaryPath))) return null;

  try {
    const content = readFileSync(join(vaultPath, glossaryPath), "utf-8");
    if (content.toLowerCase().includes(searchTerm)) {
      return {
        path: glossaryPath,
        frontmatter: { title: "Glossary", tags: ["reference"] },
        match_reason: `glossary contains: ${searchTerm}`,
      };
    }
  } catch {}

  return null;
}

/** memory_write — create or update a memory file */
export function memoryWrite(
  vaultPath: string,
  path: string,
  options: {
    frontmatter?: Record<string, unknown>;
    body?: string;
    append_body?: string;
    replace_section?: { heading: string; content: string };
    create_only?: boolean;
  },
): { path: string; created: boolean; frontmatter: Record<string, unknown> } | { error: string; message: string } {
  if (!isInsideVault(vaultPath, path)) {
    return { error: "path_traversal", message: "Path escapes vault boundary" };
  }

  const fullPath = join(vaultPath, path);
  const exists = existsSync(fullPath);

  if (options.create_only && exists) {
    return { error: "file_exists", message: `Memory file already exists: ${path}` };
  }

  let fm: Record<string, unknown> = {};
  let body = "";

  if (exists) {
    // Read existing content
    const readResult = noteRead(vaultPath, path);
    if ("error" in readResult) return readResult;
    fm = readResult.frontmatter ?? {};
    body = readResult.body;
  }

  // Merge frontmatter
  if (options.frontmatter) {
    fm = mergeFrontmatter(fm, options.frontmatter);
  }

  // Handle body updates
  if (options.body !== undefined) {
    body = options.body;
  }

  if (options.append_body) {
    body = body.trimEnd() + "\n" + options.append_body + "\n";
  }

  if (options.replace_section) {
    body = replaceSection(body, options.replace_section.heading, options.replace_section.content);
  }

  const writeResult = noteWrite(vaultPath, path, {
    frontmatter: fm,
    body,
    overwrite: true,
  });

  if ("error" in writeResult) return { error: writeResult.error, message: (writeResult as { message: string }).message };
  return { path, created: !exists, frontmatter: fm };
}

/** claudemd_read — read CLAUDE.md */
export function claudemdRead(
  vaultPath: string,
): { exists: boolean; content: string } {
  const fullPath = join(vaultPath, "CLAUDE.md");
  if (!existsSync(fullPath)) {
    return { exists: false, content: "" };
  }

  try {
    const content = readFileSync(fullPath, "utf-8");
    return { exists: true, content };
  } catch {
    return { exists: false, content: "" };
  }
}

/** claudemd_update — update CLAUDE.md */
export function claudemdUpdate(
  vaultPath: string,
  options: {
    content?: string;
    replace_section?: { heading: string; content: string };
    append?: string;
  },
): { path: string; updated: boolean } | { error: string; message: string } {
  const path = "CLAUDE.md";
  const fullPath = join(vaultPath, path);
  let current = "";

  if (existsSync(fullPath)) {
    try {
      current = readFileSync(fullPath, "utf-8");
    } catch (e) {
      return { error: "read_error", message: String(e) };
    }
  }

  let newContent: string;

  if (options.content !== undefined) {
    newContent = options.content;
  } else {
    newContent = current;

    if (options.replace_section) {
      newContent = replaceSection(
        newContent,
        options.replace_section.heading,
        options.replace_section.content,
      );
    }

    if (options.append) {
      newContent = newContent.trimEnd() + "\n" + options.append + "\n";
    }
  }

  const writeResult = noteWrite(vaultPath, path, {
    raw: newContent,
    overwrite: true,
  });

  if ("error" in writeResult) return { error: writeResult.error, message: (writeResult as { message: string }).message };
  return { path, updated: true };
}
