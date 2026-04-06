/// <reference types="node" />
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, "../../data/projects.json");
const WEB_PATH = path.resolve(__dirname, "../../web");
const UPLOAD_DIR = path.resolve(__dirname, "../../data/uploads");
const PORT = 3000;
// Ensure upload dir exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
function readDB() {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw);
}
function writeDB(db) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2), "utf-8");
}
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
};
const server = http.createServer((req, res) => {
    const rawUrl = req.url ?? "/";
    const [urlPath, queryStr] = rawUrl.split("?");
    const method = req.method ?? "GET";
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }
    // API: GET /api/db
    if (urlPath === "/api/db" && method === "GET") {
        try {
            const db = readDB();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(db));
        }
        catch {
            res.writeHead(500);
            res.end(JSON.stringify({ error: "Failed to read data" }));
        }
        return;
    }
    // API: PUT /api/db
    if (urlPath === "/api/db" && method === "PUT") {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            try {
                const db = JSON.parse(body);
                writeDB(db);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            }
            catch {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
        });
        return;
    }
    // API: POST /api/upload?name=filename.jpg
    if (urlPath === "/api/upload" && method === "POST") {
        const params = new URLSearchParams(queryStr ?? "");
        const origName = params.get("name") ?? "image";
        const safeName = origName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const fileName = `${Date.now()}_${safeName}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        const out = fs.createWriteStream(filePath);
        req.pipe(out);
        out.on("finish", () => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ url: `/uploads/${fileName}` }));
        });
        out.on("error", () => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: "Upload failed" }));
        });
        return;
    }
    // API: DELETE /api/upload?name=filename
    if (urlPath === "/api/upload" && method === "DELETE") {
        const params = new URLSearchParams(queryStr ?? "");
        const fileName = path.basename(params.get("name") ?? "");
        if (!fileName) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Missing name" }));
            return;
        }
        const filePath = path.join(UPLOAD_DIR, fileName);
        try {
            fs.unlinkSync(filePath);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
        }
        catch {
            res.writeHead(404);
            res.end(JSON.stringify({ error: "File not found" }));
        }
        return;
    }
    // Serve uploaded files: /uploads/:filename
    if (urlPath.startsWith("/uploads/")) {
        const fileName = path.basename(urlPath);
        const filePath = path.join(UPLOAD_DIR, fileName);
        const ext = path.extname(fileName).toLowerCase();
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end("Not found");
                return;
            }
            res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
            res.end(data);
        });
        return;
    }
    // Static web files
    const filePath = urlPath === "/" ? "/index.html" : urlPath;
    const fullPath = path.join(WEB_PATH, filePath);
    const ext = path.extname(fullPath).toLowerCase();
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("Not found");
            return;
        }
        res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
        res.end(data);
    });
});
server.listen(PORT, () => {
    console.log(`Gameplan UI: http://localhost:${PORT}`);
});
