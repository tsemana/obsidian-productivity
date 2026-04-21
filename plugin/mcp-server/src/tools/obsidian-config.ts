import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isInsideVault } from "../vault.js";

const ALLOWED_CONFIG_FILES = [
  "app.json",
  "appearance.json",
  "core-plugins.json",
  "core-plugins-migration.json",
  "daily-notes.json",
  "templates.json",
  "community-plugins.json",
  "hotkeys.json",
];

/** obsidian_config_read — read an Obsidian config file */
export function obsidianConfigRead(
  vaultPath: string,
  filename: string,
): { path: string; exists: boolean; content: Record<string, unknown> | null } | { error: string; message: string } {
  if (!ALLOWED_CONFIG_FILES.includes(filename)) {
    return { error: "invalid_config", message: `Not an allowed config file: ${filename}. Allowed: ${ALLOWED_CONFIG_FILES.join(", ")}` };
  }

  const relativePath = `.obsidian/${filename}`;
  if (!isInsideVault(vaultPath, relativePath)) {
    return { error: "path_traversal", message: "Path escapes vault boundary" };
  }

  const fullPath = join(vaultPath, relativePath);

  if (!existsSync(fullPath)) {
    return { path: relativePath, exists: false, content: null };
  }

  try {
    const raw = readFileSync(fullPath, "utf-8");
    const content = JSON.parse(raw);
    return { path: relativePath, exists: true, content };
  } catch (e) {
    return { error: "parse_error", message: `Failed to parse ${filename}: ${e}` };
  }
}

/** obsidian_config_write — write or update an Obsidian config file */
export function obsidianConfigWrite(
  vaultPath: string,
  filename: string,
  content: Record<string, unknown>,
  merge: boolean = true,
): { path: string; created: boolean; merged: boolean } | { error: string; message: string } {
  if (!ALLOWED_CONFIG_FILES.includes(filename)) {
    return { error: "invalid_config", message: `Not an allowed config file: ${filename}. Allowed: ${ALLOWED_CONFIG_FILES.join(", ")}` };
  }

  const relativePath = `.obsidian/${filename}`;
  if (!isInsideVault(vaultPath, relativePath)) {
    return { error: "path_traversal", message: "Path escapes vault boundary" };
  }

  // Ensure .obsidian/ exists
  const obsidianDir = join(vaultPath, ".obsidian");
  if (!existsSync(obsidianDir)) {
    mkdirSync(obsidianDir, { recursive: true });
  }

  const fullPath = join(vaultPath, relativePath);
  const exists = existsSync(fullPath);
  let merged = false;

  let finalContent = content;
  if (merge && exists) {
    try {
      const raw = readFileSync(fullPath, "utf-8");
      const existing = JSON.parse(raw);
      finalContent = { ...existing, ...content };
      merged = true;
    } catch {
      // Can't parse existing — overwrite
    }
  }

  // Atomic write
  const tmpPath = fullPath + ".tmp";
  try {
    writeFileSync(tmpPath, JSON.stringify(finalContent, null, 2) + "\n", "utf-8");
    renameSync(tmpPath, fullPath);
  } catch (e) {
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch {}
    return { error: "write_error", message: String(e) };
  }

  return { path: relativePath, created: !exists, merged };
}
