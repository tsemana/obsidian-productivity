import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { parseNote, serializeNote, matchesFrontmatter } from "../frontmatter.js";
import { isInsideVault } from "../vault.js";
import { vaultList } from "./vault-management.js";
/** note_read — read any vault file */
export function noteRead(vaultPath, path) {
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
    }
    catch (e) {
        return { error: "read_error", path, message: String(e) };
    }
}
/** note_write — write a file to the vault */
export function noteWrite(vaultPath, path, options) {
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
    let content;
    if (options.raw !== undefined) {
        content = options.raw;
    }
    else {
        content = serializeNote(options.frontmatter ?? null, options.body ?? "");
    }
    // Atomic write: write to temp, then rename
    const tmpPath = fullPath + ".tmp";
    try {
        writeFileSync(tmpPath, content, "utf-8");
        renameSync(tmpPath, fullPath);
    }
    catch (e) {
        // Clean up temp file on failure
        try {
            if (existsSync(tmpPath))
                writeFileSync(tmpPath, "", "utf-8");
        }
        catch { }
        return { error: "write_error", path, message: String(e) };
    }
    return { path, created: !exists };
}
/** note_search — search vault notes by content and/or frontmatter */
export function noteSearch(vaultPath, options, db) {
    const { query, frontmatter_filter, directory, extension = ".md", limit = 50 } = options;
    // SQLite-backed search when db is available and searching .md files
    if (db && extension === ".md") {
        return noteSearchIndexed(db, vaultPath, query, frontmatter_filter, directory, limit);
    }
    // Fallback: original file-scan implementation
    return noteSearchFileScan(vaultPath, query, frontmatter_filter, directory, extension, limit);
}
function noteSearchIndexed(db, vaultPath, query, frontmatter_filter, directory, limit) {
    const conditions = [];
    const params = [];
    if (directory && directory !== ".") {
        conditions.push("n.path LIKE ?");
        params.push(`${directory}/%`);
    }
    if (frontmatter_filter) {
        const indexedCols = ["status", "priority", "context", "project", "assigned_to", "area", "due"];
        for (const [key, value] of Object.entries(frontmatter_filter)) {
            const colName = key === "assigned-to" ? "assigned_to" : key;
            if (indexedCols.includes(colName) && typeof value === "string") {
                conditions.push(`n.${colName} = ?`);
                params.push(value);
            }
            else if (key === "tags" && typeof value === "string") {
                conditions.push("n.tags LIKE ?");
                params.push(`%${JSON.stringify(value).slice(1, -1)}%`);
            }
            else if (typeof value === "string") {
                conditions.push("n.frontmatter_json LIKE ?");
                params.push(`%${value}%`);
            }
        }
    }
    let results;
    if (query) {
        const ftsQuery = query.split(/\s+/).map((term) => `"${term.replace(/"/g, '""')}"`).join(" ");
        const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";
        const sql = `
      SELECT n.path, n.frontmatter_json, bm25(notes_fts) as rank
      FROM notes_fts fts
      JOIN notes n ON n.rowid = fts.rowid
      WHERE notes_fts MATCH ? ${where}
      ORDER BY rank
      LIMIT ?
    `;
        const rows = db.prepare(sql).all(ftsQuery, ...params, limit);
        results = rows.map((row) => {
            const entry = { path: row.path };
            if (row.frontmatter_json) {
                try {
                    entry.frontmatter = JSON.parse(row.frontmatter_json);
                }
                catch { }
            }
            try {
                const content = readFileSync(join(vaultPath, row.path), "utf-8");
                const queryLower = query.toLowerCase();
                const lines = content.split("\n");
                const matches = [];
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(queryLower)) {
                        matches.push({ line: i + 1, text: lines[i].trim() });
                        if (matches.length >= 5)
                            break;
                    }
                }
                if (matches.length > 0)
                    entry.matches = matches;
            }
            catch { }
            return entry;
        });
    }
    else {
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const sql = `SELECT path, frontmatter_json FROM notes ${where} LIMIT ?`;
        const rows = db.prepare(sql).all(...params, limit);
        results = rows.map((row) => {
            const entry = { path: row.path };
            if (row.frontmatter_json) {
                try {
                    entry.frontmatter = JSON.parse(row.frontmatter_json);
                }
                catch { }
            }
            return entry;
        });
    }
    return { results, count: results.length };
}
function noteSearchFileScan(vaultPath, query, frontmatter_filter, directory, extension, limit) {
    const searchDir = directory ?? ".";
    const listing = vaultList(vaultPath, searchDir, {
        include_frontmatter: !!frontmatter_filter,
        recursive: true,
        extension,
    });
    const results = [];
    for (const file of listing.files) {
        if (results.length >= limit)
            break;
        if (frontmatter_filter) {
            if (!file.frontmatter || !matchesFrontmatter(file.frontmatter, frontmatter_filter)) {
                continue;
            }
        }
        if (query) {
            try {
                const content = readFileSync(join(vaultPath, file.path), "utf-8");
                const queryLower = query.toLowerCase();
                const lines = content.split("\n");
                const matches = [];
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(queryLower)) {
                        matches.push({ line: i + 1, text: lines[i].trim() });
                    }
                }
                if (matches.length === 0)
                    continue;
                const result = {
                    path: file.path,
                    matches: matches.slice(0, 5),
                };
                if (file.frontmatter)
                    result.frontmatter = file.frontmatter;
                results.push(result);
            }
            catch {
                continue;
            }
        }
        else {
            const result = { path: file.path };
            if (file.frontmatter)
                result.frontmatter = file.frontmatter;
            results.push(result);
        }
    }
    return { results, count: results.length };
}
/** note_move — move a file within the vault */
export function noteMove(vaultPath, fromPath, toPath) {
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
    }
    catch (e) {
        return { error: "move_error", message: String(e) };
    }
}
//# sourceMappingURL=notes.js.map