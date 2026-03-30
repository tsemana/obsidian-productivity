import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { consolidateWikilinks, extractWikilinks } from "../wikilinks.js";
import { parseNote } from "../frontmatter.js";
import { memoryRead } from "./memory.js";
import { incrementalSync } from "../sync.js";
/** Recursively collect all .md files in the vault, skipping .obsidian */
function allMdFiles(dirPath, vaultPath) {
    const results = [];
    function walk(dir) {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith("."))
                continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            }
            else if (entry.isFile() && entry.name.endsWith(".md")) {
                results.push(relative(vaultPath, fullPath));
            }
        }
    }
    walk(dirPath);
    return results;
}
/** wikilink_consolidate — rewrite all variant links to canonical format */
export function wikilinkConsolidate(vaultPath, name, dryRun = false, db) {
    // Find the target note
    const searchResult = memoryRead(vaultPath, { search: name, type: "any" });
    if ("error" in searchResult)
        return searchResult;
    let targetPath;
    let targetFm;
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
    }
    else {
        targetPath = searchResult.path;
        targetFm = searchResult.frontmatter ?? {};
    }
    // Extract canonical filename (without .md and path prefix)
    const filename = targetPath.split("/").pop()?.replace(".md", "") ?? "";
    const displayName = targetFm.title ?? filename;
    const aliases = [
        displayName,
        filename,
        ...(targetFm.aliases ?? []),
    ];
    // Deduplicate
    const uniqueAliases = [...new Set(aliases)];
    // Scan all vault .md files
    const allFiles = allMdFiles(vaultPath, vaultPath);
    let totalLinksUpdated = 0;
    const changedFiles = [];
    for (const relPath of allFiles) {
        const fullPath = join(vaultPath, relPath);
        let content;
        try {
            content = readFileSync(fullPath, "utf-8");
        }
        catch {
            continue;
        }
        const { content: modified, changeCount } = consolidateWikilinks(content, filename, displayName, uniqueAliases);
        if (changeCount === 0)
            continue;
        totalLinksUpdated += changeCount;
        changedFiles.push({ path: relPath, count: changeCount });
        if (!dryRun) {
            try {
                writeFileSync(fullPath, modified, "utf-8");
            }
            catch {
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
/** wikilink_validate (indexed) — find broken wikilinks using SQLite index */
function wikilinkValidateIndexed(db, directory, fixSuggestions) {
    // Build known targets from the notes table
    const knownTargets = new Map(); // lowercase target → path
    const noteRows = db
        .prepare("SELECT path, title, frontmatter_json FROM notes")
        .all();
    for (const row of noteRows) {
        const name = row.path.split("/").pop()?.replace(".md", "") ?? "";
        knownTargets.set(name.toLowerCase(), row.path);
        if (row.title) {
            knownTargets.set(row.title.toLowerCase(), row.path);
        }
        if (row.frontmatter_json) {
            try {
                const fm = JSON.parse(row.frontmatter_json);
                if (Array.isArray(fm.aliases)) {
                    for (const alias of fm.aliases) {
                        if (typeof alias === "string") {
                            knownTargets.set(alias.toLowerCase(), row.path);
                        }
                    }
                }
            }
            catch {
                // Skip malformed JSON
            }
        }
    }
    // Get wikilinks, optionally filtered by directory
    let wikilinkRows;
    if (directory && directory !== ".") {
        wikilinkRows = db
            .prepare("SELECT source_path, target_slug, display_text FROM wikilinks WHERE source_path LIKE ?")
            .all(`${directory}/%`);
    }
    else {
        wikilinkRows = db
            .prepare("SELECT source_path, target_slug, display_text FROM wikilinks")
            .all();
    }
    const brokenLinks = [];
    for (const row of wikilinkRows) {
        const target = row.target_slug.toLowerCase();
        if (target.startsWith("#"))
            continue;
        const baseTarget = target.split("#")[0].trim();
        if (!baseTarget)
            continue;
        if (!knownTargets.has(baseTarget)) {
            const suggestions = [];
            if (fixSuggestions) {
                for (const [known, kPath] of knownTargets) {
                    if (known.includes(baseTarget) || baseTarget.includes(known)) {
                        suggestions.push(kPath);
                        if (suggestions.length >= 3)
                            break;
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
function wikilinkValidateFileScan(vaultPath, directory, fixSuggestions) {
    const searchDir = directory ?? ".";
    const allFiles = allMdFiles(join(vaultPath, searchDir === "." ? "" : searchDir), vaultPath);
    // Build a set of all known targets (filenames without .md, plus aliases)
    const knownTargets = new Map(); // lowercase target → file path
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
                knownTargets.set(parsed.frontmatter.title.toLowerCase(), filePath);
            }
        }
        catch {
            // Skip unreadable files
        }
    }
    const brokenLinks = [];
    for (const filePath of allFiles) {
        let content;
        try {
            content = readFileSync(join(vaultPath, filePath), "utf-8");
        }
        catch {
            continue;
        }
        const links = extractWikilinks(content);
        for (const link of links) {
            const target = link.target.toLowerCase();
            // Skip headings-only links (starts with #)
            if (target.startsWith("#"))
                continue;
            // Strip heading suffix for lookup
            const baseTarget = target.split("#")[0].trim();
            if (!baseTarget)
                continue;
            if (!knownTargets.has(baseTarget)) {
                const suggestions = [];
                if (fixSuggestions) {
                    // Simple fuzzy: find targets containing the search term
                    for (const [known, kPath] of knownTargets) {
                        if (known.includes(baseTarget) || baseTarget.includes(known)) {
                            suggestions.push(kPath);
                            if (suggestions.length >= 3)
                                break;
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
export function wikilinkValidate(vaultPath, directory, fixSuggestions = true, db) {
    if (db) {
        return wikilinkValidateIndexed(db, directory, fixSuggestions);
    }
    return wikilinkValidateFileScan(vaultPath, directory, fixSuggestions);
}
//# sourceMappingURL=wikilink-tools.js.map