import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { noteWrite, noteRead } from "./notes.js";
import { isInsideVault } from "../vault.js";

/** base_read — read and parse an Obsidian .base file (YAML) */
export function baseRead(
  vaultPath: string,
  path: string,
): { path: string; content: Record<string, unknown> } | { error: string; message: string } {
  if (!isInsideVault(vaultPath, path)) {
    return { error: "path_traversal", message: "Path escapes vault boundary" };
  }

  const fullPath = join(vaultPath, path);
  if (!existsSync(fullPath)) {
    return { error: "file_not_found", message: `Base file not found: ${path}` };
  }

  try {
    const raw = readFileSync(fullPath, "utf-8");
    const content = yaml.load(raw) as Record<string, unknown>;
    return { path, content };
  } catch (e) {
    return { error: "parse_error", message: `Failed to parse YAML in ${path}: ${e}` };
  }
}

/** base_write — write an Obsidian .base file (object → YAML) */
export function baseWrite(
  vaultPath: string,
  path: string,
  content: Record<string, unknown>,
): { path: string; created: boolean } | { error: string; message: string } {
  if (!isInsideVault(vaultPath, path)) {
    return { error: "path_traversal", message: "Path escapes vault boundary" };
  }

  try {
    const yamlStr = yaml.dump(content, {
      lineWidth: -1, // Don't wrap lines
      quotingType: "'",
      forceQuotes: false,
      noRefs: true,
    });

    return noteWrite(vaultPath, path, {
      raw: yamlStr,
      overwrite: true,
    });
  } catch (e) {
    return { error: "serialize_error", message: `Failed to serialize YAML: ${e}` };
  }
}

/** canvas_read — read and parse an Obsidian .canvas file (JSON) */
export function canvasRead(
  vaultPath: string,
  path: string,
): { path: string; nodes: unknown[]; edges: unknown[] } | { error: string; message: string } {
  if (!isInsideVault(vaultPath, path)) {
    return { error: "path_traversal", message: "Path escapes vault boundary" };
  }

  const fullPath = join(vaultPath, path);
  if (!existsSync(fullPath)) {
    return { error: "file_not_found", message: `Canvas file not found: ${path}` };
  }

  try {
    const raw = readFileSync(fullPath, "utf-8");
    const data = JSON.parse(raw);
    return {
      path,
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      edges: Array.isArray(data.edges) ? data.edges : [],
    };
  } catch (e) {
    return { error: "parse_error", message: `Failed to parse JSON in ${path}: ${e}` };
  }
}

/** canvas_write — write an Obsidian .canvas file with validation */
export function canvasWrite(
  vaultPath: string,
  path: string,
  nodes: unknown[],
  edges: unknown[] = [],
): { path: string; created: boolean; node_count: number; edge_count: number } | { error: string; message: string } {
  if (!isInsideVault(vaultPath, path)) {
    return { error: "path_traversal", message: "Path escapes vault boundary" };
  }

  // Validate node structure
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) {
      return { error: "validation_error", message: "Each node must be a non-null object" };
    }
    const n = node as Record<string, unknown>;
    if (!n.id || !n.type) {
      return { error: "validation_error", message: "Each node must have id and type fields" };
    }
  }

  // Validate edge structure
  const nodeIds = new Set(nodes.map((n) => (n as Record<string, unknown>).id));
  for (const edge of edges) {
    if (typeof edge !== "object" || edge === null) {
      return { error: "validation_error", message: "Each edge must be a non-null object" };
    }
    const e = edge as Record<string, unknown>;
    if (!e.id || !e.fromNode || !e.toNode) {
      return { error: "validation_error", message: "Each edge must have id, fromNode, and toNode fields" };
    }
    if (!nodeIds.has(e.fromNode)) {
      return { error: "validation_error", message: `Edge references non-existent fromNode: ${e.fromNode}` };
    }
    if (!nodeIds.has(e.toNode)) {
      return { error: "validation_error", message: `Edge references non-existent toNode: ${e.toNode}` };
    }
  }

  // Check ID uniqueness
  const allIds = [
    ...nodes.map((n) => (n as Record<string, unknown>).id),
    ...edges.map((e) => (e as Record<string, unknown>).id),
  ];
  const idSet = new Set(allIds);
  if (idSet.size !== allIds.length) {
    return { error: "validation_error", message: "Duplicate IDs found in nodes/edges" };
  }

  const canvasData = { nodes, edges };
  const jsonStr = JSON.stringify(canvasData, null, 2);

  const writeResult = noteWrite(vaultPath, path, {
    raw: jsonStr,
    overwrite: true,
  });

  if ("error" in writeResult) return writeResult;

  return {
    path,
    created: writeResult.created,
    node_count: nodes.length,
    edge_count: edges.length,
  };
}
