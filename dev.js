// dev.js — run the whole app locally with ONE command, from the project root:
//
//     npm start
//
// Starts the Express API (backend/) and serves the frontend from here, so there
// is no second terminal to juggle, no `npx` download, and no risk of running
// the API from the wrong folder (which produces `npm error code ENOENT`).
//
// Both run until you press Ctrl+C.
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const WEB_PORT = Number(process.env.WEB_PORT || 5173);
const API_PORT = Number(process.env.PORT || 4000);
// Localhost only by default: this server publishes the whole project directory,
// so it should not be reachable from the network. Override with WEB_HOST=0.0.0.0.
const WEB_HOST = process.env.WEB_HOST || "127.0.0.1";

// Never serve these, even though they live inside the project: secrets, the
// local database, dependencies, and server-side files.
const BLOCKED_SEGMENTS = ["node_modules", "backend", "docs", "data"];
const BLOCKED_FILES = ["dev.js", "package.json", "package-lock.json"];

function isBlocked(relativePath) {
  return relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .some(
      (segment) =>
        segment.startsWith(".") ||
        BLOCKED_SEGMENTS.includes(segment.toLowerCase()) ||
        BLOCKED_FILES.includes(segment.toLowerCase())
    );
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Minimal static file server — enough for this no-build-step frontend. */
function serveStatic(req, res) {
  const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const filePath = path.resolve(ROOT, requestPath === "/" ? "index.html" : `.${requestPath}`);
  const relativePath = path.relative(ROOT, filePath);

  // Reject anything outside the project, and anything sensitive inside it.
  const escapesProject = relativePath.startsWith("..") || path.isAbsolute(relativePath);
  if (escapesProject || isBlocked(relativePath)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Not found: ${requestPath}`);
      return;
    }
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

console.log("Starting Greenomy (API + website)...\n");

const api = spawn("npm", ["start"], {
  cwd: path.join(ROOT, "backend"),
  shell: true,
  stdio: ["ignore", "inherit", "inherit"],
});

api.on("exit", (code) => {
  console.log(`\n[api] stopped (exit code ${code}). Shutting the web server down too.`);
  process.exit(code || 0);
});

const web = http.createServer(serveStatic);
web.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${WEB_PORT} is already in use — something else is serving the site.`);
    console.error("Stop it, or run with a different port:  $env:WEB_PORT=5174; npm start\n");
  } else {
    console.error(`\nCould not start the web server: ${err.message}\n`);
  }
  shutdown();
});

web.listen(WEB_PORT, WEB_HOST, () => {
  console.log(`\n  Website:  http://localhost:${WEB_PORT}`);
  console.log(`  API:      http://localhost:${API_PORT}/api`);
  console.log("\n  Press Ctrl+C to stop both.\n");
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\nShutting down...");
  // taskkill /T kills the whole tree, so the API's node process goes with it.
  if (process.platform === "win32" && api.pid) {
    spawn("taskkill", ["/pid", String(api.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    api.kill();
  }
  web.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
