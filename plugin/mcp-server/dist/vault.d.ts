/**
 * Resolve the vault path from CLI args, env var, or CWD.
 * Returns the resolved absolute path, or null if none found.
 */
export declare function resolveVaultPath(): string | null;
/** Standard vault directories created by /start */
export declare const VAULT_DIRECTORIES: string[];
/** Check if a path exists */
export declare function pathExists(vaultPath: string, relativePath: string): boolean;
/** Check if a path is a directory */
export declare function isDirectory(vaultPath: string, relativePath: string): boolean;
/** Check if a path is a file */
export declare function isFile(vaultPath: string, relativePath: string): boolean;
/** Count files in a directory with optional extension filter */
export declare function countFiles(vaultPath: string, relativePath: string, extension?: string): number;
/** Ensure a directory exists, creating parent directories as needed */
export declare function ensureDirectory(vaultPath: string, relativePath: string): boolean;
/** Resolve a relative path within the vault to an absolute path */
export declare function vaultAbsPath(vaultPath: string, relativePath: string): string;
/** Validate that a relative path doesn't escape the vault (path traversal prevention) */
export declare function isInsideVault(vaultPath: string, relativePath: string): boolean;
//# sourceMappingURL=vault.d.ts.map