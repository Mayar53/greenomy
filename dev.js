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
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const WEB_PORT = Number(process.env.WEB_PORT || 5173);
const API_PORT = Number(process.env.PORT || 4000);
// Localhost only by default: this server publishes the whole project directory,
// so it should not be reachable from the network. Override with WEB_HOST=0.0.0.0.
const WEB_HOST = process.env.WEB_HOST || "127.0.0.1";

// Optional HTTPS. A phone only exposes its camera in a secure context, so the
// in-app camera cannot work over plain http on a LAN address:
//   $env:WEB_CERT="cert.pem"; $env:WEB_KEY="key.pem"; npm start
// Any PEM pair will do (mkcert can make one your phone will trust).
const WEB_CERT = process.env.WEB_CERT || "";
const WEB_KEY = process.env.WEB_KEY || "";
const useHttps = Boolean(WEB_CERT && WEB_KEY);
const scheme = useHttps ? "https" : "http";
const apiTarget = "127.0.0.1";

/** Every non-internal IPv4 address, so the printed URL can be typed into a
 * phone instead of being guessed. */
function lanAddresses() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if ((iface.family === "IPv4" || iface.family === 4) && !iface.internal) found.push(iface.address);
    }
  }
  return found;
}

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

/**
 * Forward /api to the local API. Serving the API from this port as well means
 * the whole app is ONE origin, which is what lets an https tunnel (or a cert on
 * the LAN) work end to end — and therefore lets a phone use its camera, since a
 * secure context cannot call a plain-http API on another port.
 */
function proxyToApi(req, res) {
  const upstream = http.request(
    {
      host: apiTarget,
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${apiTarget}:${API_PORT}` },
    },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    }
  );

  upstream.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "The API is not running — start it from backend/ (npm start)." }));
  });

  req.pipe(upstream);
}

/** Minimal static file server — enough for this no-build-step frontend. */
function serveStatic(req, res) {
  const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);

  if (requestPath === "/api" || requestPath.startsWith("/api/")) {
    proxyToApi(req, res);
    return;
  }

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

let web;
if (useHttps) {
  let tls;
  try {
    tls = { cert: fs.readFileSync(WEB_CERT), key: fs.readFileSync(WEB_KEY) };
  } catch (err) {
    console.error(`\nCannot read the https certificate (WEB_CERT / WEB_KEY): ${err.message}\n`);
    process.exit(1);
  }
  web = https.createServer(tls, serveStatic);
} else {
  web = http.createServer(serveStatic);
}

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
  const localOnly = WEB_HOST === "127.0.0.1" || WEB_HOST === "localhost";

  console.log(`\n  Website:  ${scheme}://localhost:${WEB_PORT}`);
  console.log(`  API:      ${scheme}://localhost:${WEB_PORT}/api  (proxied to :${API_PORT})`);

  if (localOnly) {
    console.log("\n  On a phone: this server is localhost-only. Restart it to reach it from the LAN:");
    console.log(`    $env:WEB_HOST="0.0.0.0"; npm start`);
  } else {
    for (const address of lanAddresses()) {
      console.log(`  On your phone:  ${scheme}://${address}:${WEB_PORT}   (same Wi-Fi)`);
    }
  }

  if (!useHttps) {
    console.log("\n  Note: over plain http a phone gets no in-app camera (browsers require a");
    console.log("  secure context) — it can still choose a photo from the gallery. For the");
    console.log("  camera, serve over https with WEB_CERT / WEB_KEY, or use an https tunnel.");
  }

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
