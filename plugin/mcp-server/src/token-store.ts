import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function tokenStoreDir(): string {
  const base = process.env.OBSIDIAN_VAULT_MCP_CONFIG_DIR
    ? process.env.OBSIDIAN_VAULT_MCP_CONFIG_DIR
    : join(homedir(), ".config", "obsidian-vault-mcp");

  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true, mode: 0o700 });
  }

  try { chmodSync(base, 0o700); } catch { /* ignore */ }

  const accountsDir = join(base, "accounts");
  if (!existsSync(accountsDir)) {
    mkdirSync(accountsDir, { recursive: true, mode: 0o700 });
  }
  try { chmodSync(accountsDir, 0o700); } catch { /* ignore */ }

  return accountsDir;
}

function tokenPath(accountId: string): string {
  const safeId = accountId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(tokenStoreDir(), `${safeId}.token`);
}

export function loadRefreshToken(accountId: string): string | null {
  const path = tokenPath(accountId);
  if (!existsSync(path)) return null;

  try {
    return readFileSync(path, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export function storeRefreshToken(accountId: string, refreshToken: string): void {
  const path = tokenPath(accountId);
  writeFileSync(path, `${refreshToken.trim()}\n`, { encoding: "utf-8", mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* ignore */ }
}

export function deleteRefreshToken(accountId: string): void {
  const path = tokenPath(accountId);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
}