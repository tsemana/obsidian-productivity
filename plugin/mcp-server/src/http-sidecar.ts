import { createServer, type Server } from "node:http";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

let server: Server | null = null;
let portFilePath: string | null = null;

export interface SidecarHandlers {
  onSync: () => Promise<void>;
  onRadarItemUpdate: (path: string, state: "resolved" | "active", email_id?: string) => void;
}

export interface SidecarOptions {
  authToken: string;
}

/** Start the HTTP sidecar on a random port */
export function startSidecar(
  vaultPath: string,
  handlers: SidecarHandlers,
  options: SidecarOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    server = createServer(async (req, res) => {
      const origin = req.headers.origin;
      const allowOrigin = origin === "null" ? "null" : undefined;
      if (allowOrigin) {
        res.setHeader("Access-Control-Allow-Origin", allowOrigin);
      }
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Radar-Token");

      if (req.method === "OPTIONS") {
        if (origin && origin !== "null") {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Forbidden origin" }));
          return;
        }
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        if (req.method === "GET" && req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }

        if (req.method === "POST" && req.url === "/sync") {
          if (!isAuthorized(req, options.authToken)) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
          await handlers.onSync();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "synced" }));
          return;
        }

        if (req.method === "POST" && req.url === "/radar/item") {
          if (!isAuthorized(req, options.authToken)) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
          const body = await readBody(req);
          const { path, state, email_id } = JSON.parse(body);
          if ((!path && !email_id) || !state) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing path/email_id or state" }));
            return;
          }
          handlers.onRadarItemUpdate(path, state, email_id);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "updated", path, email_id, state }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        portFilePath = join(vaultPath, ".radar-port");
        writeFileSync(portFilePath, String(port), "utf-8");
        resolve(port);
      } else {
        reject(new Error("Failed to get server address"));
      }
    });

    server.on("error", reject);
  });
}

/** Stop the HTTP sidecar and clean up the port file */
export function stopSidecar(): void {
  if (server) {
    server.close();
    server = null;
  }
  if (portFilePath && existsSync(portFilePath)) {
    try {
      unlinkSync(portFilePath);
    } catch {}
    portFilePath = null;
  }
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const maxBytes = 64 * 1024;
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function isAuthorized(req: import("node:http").IncomingMessage, authToken: string): boolean {
  const origin = req.headers.origin;
  if (origin && origin !== "null") return false;

  const token = req.headers["x-radar-token"];
  return typeof token === "string" && token === authToken;
}
