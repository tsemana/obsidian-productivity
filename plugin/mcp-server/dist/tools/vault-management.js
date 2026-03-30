import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VAULT_DIRECTORIES, ensureDirectory, pathExists, isDirectory, countFiles, isFile, } from "../vault.js";
import { parseNote } from "../frontmatter.js";
/** vault_init — create missing vault directories */
export function vaultInit(vaultPath, directories) {
    const dirs = directories ?? VAULT_DIRECTORIES;
    const created = [];
    const existed = [];
    for (const dir of dirs) {
        if (ensureDirectory(vaultPath, dir)) {
            created.push(dir);
        }
        else {
            existed.push(dir);
        }
    }
    return { created, existed, vault_path: vaultPath };
}
/** vault_health — check vault state */
export function vaultHealth(vaultPath) {
    const directories = {};
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
/** vault_list — list files in a vault directory */
export function vaultList(vaultPath, directory, options = {}) {
    const { include_frontmatter = false, recursive = false, extension = ".md" } = options;
    const fullPath = join(vaultPath, directory);
    if (!pathExists(vaultPath, directory) || !isDirectory(vaultPath, directory)) {
        return { directory, files: [] };
    }
    const files = [];
    collectFiles(vaultPath, fullPath, directory, extension, recursive, include_frontmatter, files);
    return { directory, files };
}
function collectFiles(vaultPath, dirPath, relativeDir, extension, recursive, includeFrontmatter, result) {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.startsWith("."))
            continue;
        const relativePath = join(relativeDir, entry.name);
        if (entry.isFile() && entry.name.endsWith(extension)) {
            const file = {
                name: entry.name,
                path: relativePath,
            };
            if (includeFrontmatter && extension === ".md") {
                try {
                    const content = readFileSync(join(dirPath, entry.name), "utf-8");
                    const parsed = parseNote(content);
                    if (parsed.frontmatter) {
                        file.frontmatter = parsed.frontmatter;
                    }
                }
                catch {
                    // Skip files that can't be read
                }
            }
            result.push(file);
        }
        else if (entry.isDirectory() && recursive) {
            collectFiles(vaultPath, join(dirPath, entry.name), relativePath, extension, recursive, includeFrontmatter, result);
        }
    }
}
//# sourceMappingURL=vault-management.js.map