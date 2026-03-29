import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { parseNote, serializeNote, mergeFrontmatter, replaceSection } from "../frontmatter.js";
import { noteWrite, noteMove, noteRead } from "./notes.js";
import { vaultList } from "./vault-management.js";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** task_create — create a new task note */
export function taskCreate(
  vaultPath: string,
  options: {
    title: string;
    status?: string;
    priority?: string;
    due?: string;
    context?: string;
    assigned_to?: string;
    project?: string;
    waiting_on?: string;
    body?: string;
    filename?: string;
  },
): { path: string; frontmatter: Record<string, unknown> } | { error: string; message: string } {
  const {
    title,
    status = "active",
    priority = "medium",
    due,
    context,
    assigned_to,
    project,
    waiting_on,
    body = "",
    filename,
  } = options;

  const slug = filename ?? slugify(title);
  const path = `tasks/${slug}.md`;

  const frontmatter: Record<string, unknown> = {
    title,
    tags: ["task"],
    status,
    priority,
    created: todayStr(),
  };

  if (due) frontmatter.due = due;
  if (context) frontmatter.context = context;
  if (assigned_to) frontmatter["assigned-to"] = assigned_to;
  if (project) frontmatter.project = project;
  if (waiting_on) {
    frontmatter["waiting-on"] = waiting_on;
    frontmatter["waiting-since"] = todayStr();
  }

  const result = noteWrite(vaultPath, path, {
    frontmatter,
    body: body || `# ${title}\n`,
    overwrite: false,
  });

  if ("error" in result) return result;
  return { path: result.path, frontmatter };
}

/** task_update — update an existing task note */
export function taskUpdate(
  vaultPath: string,
  path: string,
  options: {
    frontmatter?: Record<string, unknown>;
    append_body?: string;
    replace_section?: { heading: string; content: string };
  },
): { path: string; frontmatter: Record<string, unknown> } | { error: string; path: string; message: string } {
  const readResult = noteRead(vaultPath, path);
  if ("error" in readResult) return readResult;

  let fm = readResult.frontmatter ?? {};
  let body = readResult.body;

  if (options.frontmatter) {
    fm = mergeFrontmatter(fm, options.frontmatter);
  }

  if (options.append_body) {
    body = body.trimEnd() + "\n" + options.append_body + "\n";
  }

  if (options.replace_section) {
    body = replaceSection(body, options.replace_section.heading, options.replace_section.content);
  }

  const writeResult = noteWrite(vaultPath, path, {
    frontmatter: fm,
    body,
    overwrite: true,
  });

  if ("error" in writeResult) return { error: writeResult.error, path, message: (writeResult as { message: string }).message };
  return { path, frontmatter: fm };
}

/** task_complete — mark task done and move to tasks/done/ */
export function taskComplete(
  vaultPath: string,
  path: string,
): { old_path: string; new_path: string; completed: string } | { error: string; message: string } {
  const completed = todayStr();

  // Update frontmatter first
  const updateResult = taskUpdate(vaultPath, path, {
    frontmatter: { status: "done", completed },
  });
  if ("error" in updateResult) return updateResult;

  // Move to tasks/done/
  const filename = basename(path);
  const newPath = `tasks/done/${filename}`;

  const moveResult = noteMove(vaultPath, path, newPath);
  if ("error" in moveResult) return moveResult;

  return { old_path: path, new_path: newPath, completed };
}

/** task_list — list tasks with filtering */
export function taskList(
  vaultPath: string,
  options: {
    status?: string | string[];
    priority?: string | string[];
    context?: string;
    project?: string;
    due_before?: string;
    due_after?: string;
    include_done?: boolean;
    assigned_to?: string;
  } = {},
): { tasks: Array<{ path: string; frontmatter: Record<string, unknown>; body_preview: string }>; count: number } {
  const {
    status,
    priority,
    context,
    project,
    due_before,
    due_after,
    include_done = false,
    assigned_to,
  } = options;

  // List active tasks
  const listing = vaultList(vaultPath, "tasks", {
    include_frontmatter: true,
    recursive: false,
    extension: ".md",
  });

  let files = listing.files;

  // Optionally include done tasks
  if (include_done) {
    const doneListing = vaultList(vaultPath, "tasks/done", {
      include_frontmatter: true,
      recursive: false,
      extension: ".md",
    });
    files = files.concat(doneListing.files);
  }

  const tasks: Array<{ path: string; frontmatter: Record<string, unknown>; body_preview: string }> = [];

  for (const file of files) {
    const fm = file.frontmatter;
    if (!fm) continue;

    // Must be a task
    const tags = fm.tags;
    if (!Array.isArray(tags) || !tags.includes("task")) continue;

    // Status filter
    if (status) {
      const statusArr = Array.isArray(status) ? status : [status];
      if (!statusArr.includes(fm.status as string)) continue;
    }

    // Priority filter
    if (priority) {
      const priorityArr = Array.isArray(priority) ? priority : [priority];
      if (!priorityArr.includes(fm.priority as string)) continue;
    }

    // Context filter
    if (context) {
      const fmContext = fm.context;
      if (Array.isArray(fmContext)) {
        if (!fmContext.includes(context)) continue;
      } else if (fmContext !== context) {
        continue;
      }
    }

    // Project filter (substring match on wikilink)
    if (project && typeof fm.project === "string") {
      if (!fm.project.includes(project)) continue;
    } else if (project && !fm.project) {
      continue;
    }

    // Assigned-to filter (substring match on wikilink)
    if (assigned_to && typeof fm["assigned-to"] === "string") {
      if (!(fm["assigned-to"] as string).includes(assigned_to)) continue;
    } else if (assigned_to && !fm["assigned-to"]) {
      continue;
    }

    // Due date filters
    if (due_before && typeof fm.due === "string") {
      if (fm.due >= due_before) continue;
    } else if (due_before && !fm.due) {
      continue; // No due date, skip when filtering by due_before
    }

    if (due_after && typeof fm.due === "string") {
      if (fm.due <= due_after) continue;
    }

    // Get body preview
    let bodyPreview = "";
    try {
      const content = readFileSync(join(vaultPath, file.path), "utf-8");
      const parsed = parseNote(content);
      const lines = parsed.body.trim().split("\n").slice(0, 5);
      bodyPreview = lines.join("\n");
    } catch {
      // skip
    }

    tasks.push({
      path: file.path,
      frontmatter: fm,
      body_preview: bodyPreview,
    });
  }

  return { tasks, count: tasks.length };
}
