import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load literal KEY=VALUE assignments from local env files into process.env.
 *
 * Security note:
 * - Deliberately does NOT execute shell commands.
 * - Any previous exec(...) directives in .env.schema are ignored.
 * - Explicit environment variables already present in process.env win.
 */
export function loadEnvSchema(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const packageRoot = join(__dirname, "..");
  const envPaths = [
    join(packageRoot, ".env"),
    join(packageRoot, ".env.schema"),
  ];

  for (const envPath of envPaths) {
    let content: string;
    try {
      content = readFileSync(envPath, "utf-8");
    } catch {
      continue;
    }

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.includes("=exec(")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
      if (process.env[key]) continue;

      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (value) {
        process.env[key] = value;
      }
    }
  }
}
