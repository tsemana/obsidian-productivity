import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import {
  VAULT_DIRECTORIES,
  ensureDirectory,
  pathExists,
  isDirectory,
  countFiles,
  isFile,
} from "../vault.js";
import { parseNote } from "../frontmatter.js";

/** vault_init — create missing vault directories */
export function vaultInit(
  vaultPath: string,
  directories?: string[],
): { created: string[]; existed: string[]; vault_path: string } {
  const dirs = directories ?? VAULT_DIRECTORIES;
  const created: string[] = [];
  const existed: string[] = [];

  for (const dir of dirs) {
    if (ensureDirectory(vaultPath, dir)) {
      created.push(dir);
    } else {
      existed.push(dir);
    }
  }

  return { created, existed, vault_path: vaultPath };
}

/** vault_health — check vault state */
export function vaultHealth(vaultPath: string): {
  has_obsidian_config: boolean;
  has_claude_md: boolean;
  directories: Record<string, { exists: boolean; file_count: number }>;
  total_notes: number;
} {
  const directories: Record<string, { exists: boolean; file_count: number }> =
    {};
  let totalNotes = 0;

  for (const dir of VAULT_DIRECTORIES) {
    const exists = isDirectory(vaultPath, dir);
    const fileCount = exists ? countFiles(vaultPath, dir, ".md") : 0;
    directories[dir] = { exists, file_count: fileCount };
    totalNotes += fileCount;
  }

  return {
    has_obsidian_config: isDirectory(vaultPath, ".obsidian"),
    has_claude_md: isFile(vaultPath, "CLAUDE.md"),
    directories,
    total_notes: totalNotes,
  };
}

export interface VaultListFile {
  name: string;
  path: string;
  frontmatter?: Record<string, unknown>;
}

/** vault_list — list files in a vault directory */
export function vaultList(
  vaultPath: string,
  directory: string,
  options: {
    include_frontmatter?: boolean;
    recursive?: boolean;
    extension?: string;
  } = {},
): { directory: string; files: VaultListFile[] } {
  const { include_frontmatter = false, recursive = false, extension = ".md" } =
    options;

  const fullPath = join(vaultPath, directory);
  if (!pathExists(vaultPath, directory) || !isDirectory(vaultPath, directory)) {
    return { directory, files: [] };
  }

  const files: VaultListFile[] = [];
  collectFiles(vaultPath, fullPath, directory, extension, recursive, include_frontmatter, files);

  return { directory, files };
}

function collectFiles(
  vaultPath: string,
  dirPath: string,
  relativeDir: string,
  extension: string,
  recursive: boolean,
  includeFrontmatter: boolean,
  result: VaultListFile[],
): void {
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const relativePath = join(relativeDir, entry.name);

    if (entry.isFile() && entry.name.endsWith(extension)) {
      const file: VaultListFile = {
        name: entry.name,
        path: relativePath,
      };

      if (includeFrontmatter && extension === ".md") {
        try {
          const content = readFileSync(
            join(dirPath, entry.name),
            "utf-8",
          );
          const parsed = parseNote(content);
          if (parsed.frontmatter) {
            file.frontmatter = parsed.frontmatter;
          }
        } catch {
          // Skip files that can't be read
        }
      }

      result.push(file);
    } else if (entry.isDirectory() && recursive) {
      collectFiles(
        vaultPath,
        join(dirPath, entry.name),
        relativePath,
        extension,
        recursive,
        includeFrontmatter,
        result,
      );
    }
  }
}
