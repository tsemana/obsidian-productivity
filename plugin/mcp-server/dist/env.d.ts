/**
 * Load literal KEY=VALUE assignments from local env files into process.env.
 *
 * Security note:
 * - Deliberately does NOT execute shell commands.
 * - Any previous exec(...) directives in .env.schema are ignored.
 * - Explicit environment variables already present in process.env win.
 */
export declare function loadEnvSchema(): void;
//# sourceMappingURL=env.d.ts.map