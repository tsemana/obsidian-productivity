#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveVaultPath } from "./vault.js";

// Tool implementations
import { vaultInit, vaultHealth, vaultList } from "./tools/vault-management.js";
import { noteRead, noteWrite, noteSearch, noteMove } from "./tools/notes.js";
import { obsidianConfigRead, obsidianConfigWrite } from "./tools/obsidian-config.js";
import { taskCreate, taskUpdate, taskComplete, taskList } from "./tools/tasks.js";
import { memoryRead, memoryWrite, claudemdRead, claudemdUpdate } from "./tools/memory.js";
import { wikilinkConsolidate, wikilinkValidate } from "./tools/wikilink-tools.js";
import { baseRead, baseWrite, canvasRead, canvasWrite } from "./tools/bases-canvas.js";

const server = new McpServer({
  name: "obsidian-vault",
  version: "0.7.0",
});

// Resolve vault path once at startup
const vaultPath = resolveVaultPath();

function requireVault(): string {
  if (!vaultPath) {
    throw new Error(
      "No vault path configured. Set OBSIDIAN_VAULT_PATH environment variable, " +
      "pass the vault path as a command-line argument, or run from inside the vault directory."
    );
  }
  return vaultPath;
}

// ─── Group 1: Vault Management ─────────────────────────────────────────────

server.tool(
  "vault_init",
  "Create missing vault directories (tasks/, daily/, memory/, templates/, bases/, canvas/ and subdirectories). Returns what was created vs what already existed.",
  { directories: z.array(z.string()).optional().describe("Specific directories to create. Default: full standard set.") },
  async ({ directories }) => ({
    content: [{ type: "text", text: JSON.stringify(vaultInit(requireVault(), directories), null, 2) }],
  }),
);

server.tool(
  "vault_health",
  "Check vault state: verify expected directories exist, count notes by type, check for CLAUDE.md, check .obsidian/ config presence.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(vaultHealth(requireVault()), null, 2) }],
  }),
);

server.tool(
  "vault_list",
  "List files in a vault directory. Returns filenames with optional frontmatter summary.",
  {
    directory: z.string().describe("Relative path from vault root, e.g. 'tasks', 'memory/people', 'daily'"),
    include_frontmatter: z.boolean().optional().describe("Parse and return frontmatter for each file"),
    recursive: z.boolean().optional().describe("Include subdirectories"),
    extension: z.string().optional().describe("File extension filter, e.g. '.md', '.base', '.canvas'"),
  },
  async ({ directory, include_frontmatter, recursive, extension }) => ({
    content: [{ type: "text", text: JSON.stringify(
      vaultList(requireVault(), directory, { include_frontmatter, recursive, extension }), null, 2,
    ) }],
  }),
);

// ─── Group 2: Task Operations ──────────────────────────────────────────────

server.tool(
  "task_create",
  "Create a new task note in tasks/ with frontmatter and optional body content. Enforces the task schema (title, tags:[task], status, priority, created).",
  {
    title: z.string().describe("Task name"),
    status: z.enum(["active", "waiting", "someday"]).optional().describe("Task state (default: active)"),
    priority: z.enum(["high", "medium", "low"]).optional().describe("Priority level (default: medium)"),
    due: z.string().optional().describe("Due date in YYYY-MM-DD format"),
    context: z.string().optional().describe("Context: 'work' or 'personal'"),
    assigned_to: z.string().optional().describe("Wikilink to person, e.g. '[[todd-martinez|Todd]]'"),
    project: z.string().optional().describe("Wikilink to project, e.g. '[[project-phoenix|Phoenix]]'"),
    waiting_on: z.string().optional().describe("Wikilink to person (when status=waiting)"),
    body: z.string().optional().describe("Markdown body content below frontmatter"),
    filename: z.string().optional().describe("Custom filename slug; auto-generated from title if omitted"),
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(taskCreate(requireVault(), params), null, 2) }],
  }),
);

server.tool(
  "task_update",
  "Update an existing task note. Can modify frontmatter fields, append to body, or replace body sections. Merges with existing frontmatter.",
  {
    path: z.string().describe("Relative path from vault root, e.g. 'tasks/review-budget.md'"),
    frontmatter: z.record(z.string(), z.unknown()).optional().describe("Fields to merge into existing frontmatter"),
    append_body: z.string().optional().describe("Text to append to the body"),
    replace_section: z.object({
      heading: z.string(),
      content: z.string(),
    }).optional().describe("Replace a ## heading section"),
  },
  async ({ path, frontmatter, append_body, replace_section }) => ({
    content: [{ type: "text", text: JSON.stringify(
      taskUpdate(requireVault(), path, { frontmatter, append_body, replace_section }), null, 2,
    ) }],
  }),
);

server.tool(
  "task_complete",
  "Mark a task as done: sets status=done, adds completed date, and moves the file from tasks/ to tasks/done/.",
  {
    path: z.string().describe("Relative path to the task file in tasks/"),
  },
  async ({ path }) => ({
    content: [{ type: "text", text: JSON.stringify(taskComplete(requireVault(), path), null, 2) }],
  }),
);

server.tool(
  "task_list",
  "List task notes with frontmatter, optionally filtered by status, priority, context, project, or due date range.",
  {
    status: z.union([z.string(), z.array(z.string())]).optional().describe("Filter by status value(s)"),
    priority: z.union([z.string(), z.array(z.string())]).optional().describe("Filter by priority"),
    context: z.string().optional().describe("Filter by context"),
    project: z.string().optional().describe("Filter by project wikilink substring"),
    due_before: z.string().optional().describe("YYYY-MM-DD, tasks due before this date"),
    due_after: z.string().optional().describe("YYYY-MM-DD, tasks due after this date"),
    include_done: z.boolean().optional().describe("Also search tasks/done/"),
    assigned_to: z.string().optional().describe("Filter by assigned-to wikilink substring"),
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(taskList(requireVault(), params), null, 2) }],
  }),
);

// ─── Group 3: Memory Operations ────────────────────────────────────────────

server.tool(
  "memory_read",
  "Read a memory file (person, project, glossary, company context) by path or by searching for a name/alias.",
  {
    path: z.string().optional().describe("Direct path, e.g. 'memory/people/todd-martinez.md'"),
    search: z.string().optional().describe("Search by name/alias across memory files"),
    type: z.enum(["person", "project", "glossary", "context", "any"]).optional().describe("Narrow search scope"),
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(memoryRead(requireVault(), params), null, 2) }],
  }),
);

server.tool(
  "memory_write",
  "Create or update a memory file (person, project, glossary entry, company context). For glossary.md, can append entries to specific tables.",
  {
    path: z.string().describe("Relative path, e.g. 'memory/people/maya-tanaka.md'"),
    frontmatter: z.record(z.string(), z.unknown()).optional().describe("Frontmatter to set/merge"),
    body: z.string().optional().describe("Full body content (replaces existing body)"),
    append_body: z.string().optional().describe("Append to existing body"),
    replace_section: z.object({
      heading: z.string(),
      content: z.string(),
    }).optional().describe("Replace a ## heading section"),
    create_only: z.boolean().optional().describe("Fail if file already exists"),
  },
  async ({ path, ...options }) => ({
    content: [{ type: "text", text: JSON.stringify(memoryWrite(requireVault(), path, options), null, 2) }],
  }),
);

server.tool(
  "claudemd_read",
  "Read the CLAUDE.md file from the vault root. This is the hot-cache working memory file.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(claudemdRead(requireVault()), null, 2) }],
  }),
);

server.tool(
  "claudemd_update",
  "Update CLAUDE.md. Can replace a specific section by heading, append content, or write the entire file.",
  {
    content: z.string().optional().describe("Full file content (replaces everything)"),
    replace_section: z.object({
      heading: z.string(),
      content: z.string(),
    }).optional().describe("Replace a ## heading section"),
    append: z.string().optional().describe("Text to append"),
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(claudemdUpdate(requireVault(), params), null, 2) }],
  }),
);

// ─── Group 4: Note Operations ──────────────────────────────────────────────

server.tool(
  "note_read",
  "Read any file in the vault. Returns frontmatter (if present) and body content. Works with .md, .base, .canvas, and .json files.",
  {
    path: z.string().describe("Relative path from vault root"),
  },
  async ({ path }) => ({
    content: [{ type: "text", text: JSON.stringify(noteRead(requireVault(), path), null, 2) }],
  }),
);

server.tool(
  "note_write",
  "Write a file to the vault. For markdown files, accepts separate frontmatter and body. For other formats, accepts raw content. Creates parent directories if needed.",
  {
    path: z.string().describe("Relative path from vault root"),
    frontmatter: z.record(z.string(), z.unknown()).optional().describe("YAML frontmatter (markdown files only)"),
    body: z.string().optional().describe("Markdown body content"),
    raw: z.string().optional().describe("Raw file content (for non-markdown: .base YAML, .canvas JSON, .json)"),
    overwrite: z.boolean().optional().describe("If false, fail when file exists"),
  },
  async ({ path, ...options }) => ({
    content: [{ type: "text", text: JSON.stringify(noteWrite(requireVault(), path, options), null, 2) }],
  }),
);

server.tool(
  "note_search",
  "Search vault notes by text content and/or frontmatter properties. Returns matching files with context.",
  {
    query: z.string().optional().describe("Text search across file contents"),
    frontmatter_filter: z.record(z.string(), z.unknown()).optional().describe("Filter by frontmatter property values"),
    directory: z.string().optional().describe("Restrict search to a directory"),
    extension: z.string().optional().describe("File extension (default: .md)"),
    limit: z.number().optional().describe("Max results (default: 50)"),
  },
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(noteSearch(requireVault(), params), null, 2) }],
  }),
);

server.tool(
  "note_move",
  "Move a file within the vault. Used primarily for archiving tasks to tasks/done/.",
  {
    from_path: z.string().describe("Current relative path"),
    to_path: z.string().describe("Destination relative path"),
  },
  async ({ from_path, to_path }) => ({
    content: [{ type: "text", text: JSON.stringify(noteMove(requireVault(), from_path, to_path), null, 2) }],
  }),
);

// ─── Group 5: Wikilink Operations ──────────────────────────────────────────

server.tool(
  "wikilink_consolidate",
  "Consolidate all wikilinks for a given note to the canonical [[filename-slug|Display Name]] format. Finds the target note, collects its aliases, and rewrites all variant links across the vault.",
  {
    name: z.string().describe("Person/project/note name to consolidate (matched against title, aliases, filename)"),
    dry_run: z.boolean().optional().describe("Preview changes without writing"),
  },
  async ({ name, dry_run }) => ({
    content: [{ type: "text", text: JSON.stringify(
      wikilinkConsolidate(requireVault(), name, dry_run), null, 2,
    ) }],
  }),
);

server.tool(
  "wikilink_validate",
  "Scan the vault for broken wikilinks — links whose targets don't exist as files or aliases. Returns broken links with suggested corrections.",
  {
    directory: z.string().optional().describe("Restrict scan to a directory"),
    fix_suggestions: z.boolean().optional().describe("Attempt to suggest closest matching files"),
  },
  async ({ directory, fix_suggestions }) => ({
    content: [{ type: "text", text: JSON.stringify(
      wikilinkValidate(requireVault(), directory, fix_suggestions), null, 2,
    ) }],
  }),
);

// ─── Group 6: Bases & Canvas ───────────────────────────────────────────────

server.tool(
  "base_read",
  "Read and parse an Obsidian .base file (YAML format). Returns the parsed structure as JSON.",
  {
    path: z.string().describe("Relative path to .base file"),
  },
  async ({ path }) => ({
    content: [{ type: "text", text: JSON.stringify(baseRead(requireVault(), path), null, 2) }],
  }),
);

server.tool(
  "base_write",
  "Write an Obsidian .base file. Accepts the base definition as a structured object and serializes to YAML.",
  {
    path: z.string().describe("Relative path, e.g. 'bases/tasks.base'"),
    content: z.record(z.string(), z.unknown()).describe("Base definition (filters, formulas, properties, views)"),
  },
  async ({ path, content }) => ({
    content: [{ type: "text", text: JSON.stringify(baseWrite(requireVault(), path, content), null, 2) }],
  }),
);

server.tool(
  "canvas_read",
  "Read and parse an Obsidian .canvas file (JSON format). Returns nodes and edges.",
  {
    path: z.string().describe("Relative path to .canvas file"),
  },
  async ({ path }) => ({
    content: [{ type: "text", text: JSON.stringify(canvasRead(requireVault(), path), null, 2) }],
  }),
);

server.tool(
  "canvas_write",
  "Write an Obsidian .canvas file. Validates node/edge structure before writing.",
  {
    path: z.string().describe("Relative path, e.g. 'canvas/project-map.canvas'"),
    nodes: z.array(z.record(z.string(), z.unknown())).describe("Canvas nodes"),
    edges: z.array(z.record(z.string(), z.unknown())).optional().describe("Canvas edges"),
  },
  async ({ path, nodes, edges }) => ({
    content: [{ type: "text", text: JSON.stringify(
      canvasWrite(requireVault(), path, nodes, edges), null, 2,
    ) }],
  }),
);

// ─── Group 7: Obsidian Config ──────────────────────────────────────────────

server.tool(
  "obsidian_config_read",
  "Read an Obsidian config file from .obsidian/ directory. Returns parsed JSON.",
  {
    filename: z.string().describe("Config filename, e.g. 'app.json', 'core-plugins.json', 'daily-notes.json'"),
  },
  async ({ filename }) => ({
    content: [{ type: "text", text: JSON.stringify(obsidianConfigRead(requireVault(), filename), null, 2) }],
  }),
);

server.tool(
  "obsidian_config_write",
  "Write or update an Obsidian config file in .obsidian/. Creates .obsidian/ directory if needed. Merges with existing content by default.",
  {
    filename: z.string().describe("Config filename"),
    content: z.record(z.string(), z.unknown()).describe("JSON content to write"),
    merge: z.boolean().optional().describe("Merge with existing content (default: true)"),
  },
  async ({ filename, content, merge }) => ({
    content: [{ type: "text", text: JSON.stringify(
      obsidianConfigWrite(requireVault(), filename, content, merge), null, 2,
    ) }],
  }),
);

// ─── Start Server ──────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
