import { createServer } from "node:http";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
let server = null;
let portFilePath = null;
/** Start the HTTP sidecar on a random port */
export function startSidecar(vaultPath, handlers) {
    return new Promise((resolve, reject) => {
        server = createServer(async (req, res) => {
            // CORS headers for local browser access
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type");
            if (req.method === "OPTIONS") {
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
                    await handlers.onSync();
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ status: "synced" }));
                    return;
                }
                if (req.method === "POST" && req.url === "/radar/item") {
                    const body = await readBody(req);
                    const { path, state } = JSON.parse(body);
                    if (!path || !state) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "Missing path or state" }));
                        return;
                    }
                    handlers.onRadarItemUpdate(path, state);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ status: "updated", path, state }));
                    return;
                }
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Not found" }));
            }
            catch (e) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address();
            if (typeof addr === "object" && addr) {
                const port = addr.port;
                portFilePath = join(vaultPath, ".radar-port");
                writeFileSync(portFilePath, String(port), "utf-8");
                resolve(port);
            }
            else {
                reject(new Error("Failed to get server address"));
            }
        });
        server.on("error", reject);
    });
}
/** Stop the HTTP sidecar and clean up the port file */
export function stopSidecar() {
    if (server) {
        server.close();
        server = null;
    }
    if (portFilePath && existsSync(portFilePath)) {
        try {
            unlinkSync(portFilePath);
        }
        catch { }
        portFilePath = null;
    }
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}
//# sourceMappingURL=http-sidecar.js.map