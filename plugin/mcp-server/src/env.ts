import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Parse .env.schema and load exec() directives into process.env.
 * Silently skips lines that fail — credentials become optional
 * (gcloud fallback still works).
 */
export function loadEnvSchema(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // .env.schema lives in the package root, one level up from src/
  const schemaPath = join(__dirname, "..", ".env.schema");

  let content: string;
  try {
    content = readFileSync(schemaPath, "utf-8");
  } catch {
    // No .env.schema found — not an error, credentials just won't be auto-loaded
    return;
  }

  const execPattern = /^([A-Z_]+)=exec\(`(.+)`\)\s*$/;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Skip if already set in environment (explicit env vars take precedence)
    const match = trimmed.match(execPattern);
    if (!match) continue;

    const [, key, command] = match;
    if (process.env[key]) continue;

    try {
      const value = execSync(command, {
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (value) {
        process.env[key] = value;
      }
    } catch {
      // Silent skip — log to stderr for debugging
      console.error(`env.ts: Failed to resolve ${key} from .env.schema (continuing without it)`);
    }
  }
}
