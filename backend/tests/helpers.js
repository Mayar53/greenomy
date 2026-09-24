// tests/helpers.js — boots the real API against a throwaway PGlite database.
// No extra dependencies: node:test for the runner, global fetch for requests,
// and the project's own migrate/seed scripts as child processes.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

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

  // Verification images are written to a throwaway directory inside the test
  // temp dir, never the project's uploads/ folder. The size limit is lowered so
  // an "oversized upload" test does not have to build an 8 MB file.
  process.env.IMAGE_STORAGE_DIR = path.join(dir, "uploads");
  process.env.IMAGE_MAX_BYTES = "400000";

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

/**
 * A real, decodable JPEG as a data URL. Verification now measures the actual
 * bytes server-side, so a fake base64 blob is correctly rejected — fixtures
 * have to be images.
 *
 * `green: true` is a bright, sharp, mostly-green frame that scores above the
 * auto-approve threshold; `green: false` is a flat dim grey that does not.
 * Each tag renders a structurally different picture, so two tests' fixtures are
 * not mistaken for duplicates of each other.
 */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A small deterministic PRNG, so a tag always renders the same picture. */
function seeded(seed) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

const clamp8 = (value) => Math.max(0, Math.min(255, Math.round(value)));

async function photoDataUrl(tag = "PHOTO", { green = true } = {}) {
  const size = 96;
  const blocks = 6; // 16px blocks — low-frequency content that survives re-encoding
  const raw = Buffer.alloc(size * size * 3);
  const cell = size / blocks;

  // Per-tag block levels: different tags paint a genuinely different picture, so
  // their perceptual hashes are far apart (and no two tags are byte-identical).
  const random = seeded(fnv1a(String(tag)));
  const levels = Array.from({ length: blocks * blocks }, () => random() % 8);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 3;
      const level = levels[Math.floor(y / cell) * blocks + Math.floor(x / cell)];

      if (!green) {
        const grey = clamp8(95 + level * 3);
        raw[i] = grey;
        raw[i + 1] = grey;
        raw[i + 2] = grey;
        continue;
      }

      // A 1px checkerboard gives the frame real detail (sharpness); it averages
      // out in the 32x32 hash downsample, so the block layout drives the hash.
      const detail = (x + y) % 2 === 0 ? 25 : -25;
      raw[i] = clamp8(10 + level * 8 + detail);
      raw[i + 1] = clamp8(120 + level * 16 + detail);
      raw[i + 2] = clamp8(10 + level * 6 + detail);
    }
  }

  const buffer = await sharp(raw, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

/** Re-encodes an image at a different quality: different bytes, near-identical
 * picture — exactly what a "near duplicate" is meant to catch. */
async function reencodeDataUrl(dataUrl, quality = 55) {
  const base64 = String(dataUrl).split(",")[1];
  const buffer = await sharp(Buffer.from(base64, "base64")).jpeg({ quality }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

/** Submits a photo. `pixelStats` is only a hint now: a low green ratio picks the
 * dim fixture. The server re-derives the numbers from the bytes. */
async function submitPhoto(base, token, plantId, pixelStats, tag = "PHOTO", extra = {}) {
  const dim = pixelStats && Number(pixelStats.greenRatio) < 0.2;
  const imageUrl = await photoDataUrl(tag, { green: !dim });
  return post(base, "/verifications", { token, body: { plantId, imageUrl, ...extra } });
}

/** Submits an exact data URL (for duplicate-detection tests). */
async function submitRawPhoto(base, token, plantId, imageUrl, extra = {}) {
  return post(base, "/verifications", { token, body: { plantId, imageUrl, ...extra } });
}

async function issueChallenge(base, token, plantId) {
  const res = await post(base, "/verifications/challenge", {
    token,
    body: plantId ? { plantId } : {},
  });
  return res.body;
}

/** Multipart upload, the way the camera page sends a photo. */
async function postMultipart(base, urlPath, { token, file, fields = {} } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append("image", new Blob([file.buffer], { type: file.type }), file.name || "photo.jpg");

  const response = await fetch(base + urlPath, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
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
  submitRawPhoto,
  issueChallenge,
  postMultipart,
  photoDataUrl,
  reencodeDataUrl,
  uniqueEmail,
};
