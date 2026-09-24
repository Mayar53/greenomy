// tests/helpers.js — boots the real API against a throwaway PGlite database.
// No extra dependencies: node:test for the runner, global fetch for requests,
// and the project's own migrate/seed scripts as child processes.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BACKEND = path.join(__dirname, "..");

const ADMIN_EMAIL = "admin@greenomy.test";
const ADMIN_PASSWORD = "admin-test-password";

/**
 * Points the process at a fresh, migrated, seeded database in a temp dir.
 * MUST be called before requiring ../server — the db module reads its
 * configuration once, at require time.
 */
function createTestDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greenomy-test-"));

  // Set explicitly: the dev admin default in seed.js is skipped when the
  // ambient NODE_ENV is production, which it is in some environments.
  process.env.DB_DRIVER = "pglite";
  process.env.PGLITE_DIR = dir;
  process.env.JWT_SECRET = "test-secret";
  process.env.VERIFICATION_PROVIDER = "heuristic";
  process.env.ADMIN_SEED_EMAIL = ADMIN_EMAIL;
  process.env.ADMIN_SEED_PASSWORD = ADMIN_PASSWORD;
  // Not "production": the dev mail outbox and rate-limit skips key off this.
  process.env.NODE_ENV = "test";

  // Tests must never reach a real AI provider, and must never depend on (or
  // spend) a developer's own key from .env. Setting these to "" rather than
  // deleting them is what makes that work: dotenv only fills keys that are
  // absent from process.env, so an empty value keeps backend/.env out.
  process.env.AI_API_KEY = "";
  process.env.AI_VERIFICATION_API_KEY = "";
  process.env.AI_API_URL = "";
  process.env.AI_MODEL = "";
  process.env.AI_FALLBACK_MODELS = "";
  process.env.AI_MAX_ATTEMPTS = "1";

  // Same reasoning for weather: the offline climate table means no test depends
  // on the network, on a city resolving, or on Open-Meteo's availability.
  process.env.WEATHER_PROVIDER = "offline";

  for (const script of ["database/migrate.js", "database/seed.js"]) {
    execFileSync(process.execPath, [script], { cwd: BACKEND, env: process.env, stdio: "pipe" });
  }

  return dir;
}

/** Mounts the app on an ephemeral port and returns its base URL. */
async function startServer() {
  const app = require("../server");
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  return {
    server,
    base: `http://127.0.0.1:${port}/api`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function request(base, method, urlPath, { token, body } = {}) {
  const response = await fetch(base + urlPath, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

const get = (base, p, opts) => request(base, "GET", p, opts);
const post = (base, p, opts) => request(base, "POST", p, opts);
const patch = (base, p, opts) => request(base, "PATCH", p, opts);
const del = (base, p, opts) => request(base, "DELETE", p, opts);

let seq = 0;
function uniqueEmail(prefix = "user") {
  seq += 1;
  return `${prefix}_${Date.now()}_${seq}@example.test`;
}

async function signup(base, overrides = {}) {
  const body = {
    fullName: "Test User",
    email: uniqueEmail(),
    password: "password123",
    ...overrides,
  };
  const res = await post(base, "/auth/signup", { body });
  return { res, token: res.body && res.body.token, user: res.body && res.body.user };
}

async function loginAdmin(base) {
  const res = await post(base, "/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  return { res, token: res.body && res.body.token };
}

/** A submission certain to auto-approve (>= 0.85). */
const SHARP_GREEN_PHOTO = { greenRatio: 0.55, sharpness: 22, brightness: 0.55 };
/** A submission certain to queue for review (< 0.85). */
const DIM_PHOTO = { greenRatio: 0.1, sharpness: 4, brightness: 0.5 };

async function createPlant(base, token, overrides = {}) {
  const res = await post(base, "/plants", {
    token,
    body: { plantType: "Pumpkin", plantingMethod: "From Seed", location: "Roof", ...overrides },
  });
  return res.body;
}

async function submitPhoto(base, token, plantId, pixelStats, tag = "PHOTO") {
  return post(base, "/verifications", {
    token,
    body: {
      plantId,
      imageUrl: `data:image/jpeg;base64,${tag}`,
      pixelStats,
    },
  });
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can keep the PGlite data dir locked until the process exits;
    // the temp dir is harmless either way.
  }
}

module.exports = {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  SHARP_GREEN_PHOTO,
  DIM_PHOTO,
  createTestDatabase,
  startServer,
  cleanup,
  request,
  get,
  post,
  patch,
  del,
  signup,
  loginAdmin,
  createPlant,
  submitPhoto,
  uniqueEmail,
};
