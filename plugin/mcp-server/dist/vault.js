import { existsSync, statSync, readdirSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve, relative, sep, isAbsolute } from "node:path";
/**
 * Resolve the vault path from CLI args, env var, or CWD.
 * Returns the resolved absolute path, or null if none found.
 */
export function resolveVaultPath() {
    // Priority 1: CLI argument
    const cliArg = process.argv[2];
    if (cliArg) {
        const resolved = resolve(cliArg);
        if (existsSync(resolved) && statSync(resolved).isDirectory()) {
            return resolved;
        }
    }
    // Priority 2: Environment variable
    const envPath = process.env.OBSIDIAN_VAULT_PATH;
    if (envPath) {
        const resolved = resolve(envPath);
        if (existsSync(resolved) && statSync(resolved).isDirectory()) {
            return resolved;
        }
    }
    // Priority 3: Current working directory (Cowork fallback)
    const cwd = process.cwd();
    if (existsSync(cwd) && statSync(cwd).isDirectory() && looksLikeVault(cwd)) {
        return cwd;
    }
    return null;
}
function looksLikeVault(path) {
    const markers = [
        ".obsidian",
        "CLAUDE.md",
        "tasks",
        "daily",
        "memory",
        "templates",
    ];
    return markers.some((marker) => existsSync(join(path, marker)));
}
/** Standard vault directories created by /start */
export const VAULT_DIRECTORIES = [
    "tasks",
    "tasks/done",
    "daily",
    "references",
    "inbox",
    "memory",
    "memory/people",
    "memory/projects",
    "memory/context",
    "memory/areas",
    "templates",
    "bases",
    "canvas",
];
/** Check if a path exists */
export function pathExists(vaultPath, relativePath) {
    return existsSync(join(vaultPath, relativePath));
}
/** Check if a path is a directory */
export function isDirectory(vaultPath, relativePath) {
    const fullPath = join(vaultPath, relativePath);
    return existsSync(fullPath) && statSync(fullPath).isDirectory();
}
/** Check if a path is a file */
export function isFile(vaultPath, relativePath) {
    const fullPath = join(vaultPath, relativePath);
    return existsSync(fullPath) && statSync(fullPath).isFile();
}
/** Count files in a directory with optional extension filter */
export function countFiles(vaultPath, relativePath, extension) {
    const fullPath = join(vaultPath, relativePath);
    if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
        return 0;
    }
    const entries = readdirSync(fullPath, { withFileTypes: true });
    return entries.filter((e) => {
        if (!e.isFile())
            return false;
        if (extension && !e.name.endsWith(extension))
            return false;
        return true;
    }).length;
}
/** Ensure a directory exists, creating parent directories as needed */
export function ensureDirectory(vaultPath, relativePath) {
    const fullPath = join(vaultPath, relativePath);
    if (existsSync(fullPath)) {
        return false; // already existed
    }
    mkdirSync(fullPath, { recursive: true });
    return true; // created
}
/** Resolve a relative path within the vault to an absolute path */
export function vaultAbsPath(vaultPath, relativePath) {
    return join(vaultPath, relativePath);
}
/** Validate that a relative path doesn't escape the vault (path traversal prevention) */
export function isInsideVault(vaultPath, relativePath) {
    if (!relativePath || isAbsolute(relativePath))
        return false;
    const vaultResolved = resolve(vaultPath);
    const candidateResolved = resolve(vaultResolved, relativePath);
    const rel = relative(vaultResolved, candidateResolved);
    if (rel === "")
        return true;
    if (rel === ".." || rel.startsWith(`..${sep}`))
        return false;
    try {
        const vaultReal = realpathSync(vaultResolved);
        const existingReal = existsSync(candidateResolved)
            ? realpathSync(candidateResolved)
            : realpathSync(join(candidateResolved, ".."));
        const realRel = relative(vaultReal, existingReal);
        if (realRel === "")
            return true;
        return !(realRel === ".." || realRel.startsWith(`..${sep}`));
    }
    catch {
        return true;
    }
}
//# sourceMappingURL=vault.js.map