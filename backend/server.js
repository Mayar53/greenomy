// server.js — Greenomy REST API entrypoint
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { ping, assertConfigured } = require("./config/db");
const securityHeaders = require("./middleware/security-headers");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/users.routes");
const plantRoutes = require("./routes/plants.routes");
const verificationRoutes = require("./routes/verifications.routes");
const adminVerificationRoutes = require("./routes/admin-verifications.routes");
const adminRoutes = require("./routes/admin.routes");
const rewardRoutes = require("./routes/rewards.routes");
const walletRoutes = require("./routes/wallet.routes");
const greenHubRoutes = require("./routes/green-hub.routes");
const impactRoutes = require("./routes/impact.routes");
const waitlistRoutes = require("./routes/waitlist.routes");
const partnerRoutes = require("./routes/partners.routes");
const notificationRoutes = require("./routes/notifications.routes");

const app = express();

const isProduction = process.env.NODE_ENV === "production";

// Don't advertise the framework.
app.disable("x-powered-by");
app.use(securityHeaders);

// Safety net: a stray rejection must never take the API down.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
});

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Never fall back to a wildcard in production: an unset CORS_ORIGIN there
// means "no browser origin is allowed", not "everyone is".
const corsOrigin = allowedOrigins.length ? allowedOrigins : isProduction ? [] : "*";
const corsWildcard = corsOrigin === "*" || (Array.isArray(corsOrigin) && corsOrigin.includes("*"));

app.use(cors({
  origin: corsWildcard ? "*" : corsOrigin,
  credentials: true,
}));
app.use(express.json({ limit: "5mb" }));

// General API rate limiting — tighter limits are applied per-route where needed
// (e.g. auth, waitlist) inside their respective route files.
app.use(
  "/api",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false })
);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/plants", plantRoutes);
app.use("/api/verifications", verificationRoutes);
app.use("/api/admin/verifications", adminVerificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/rewards", rewardRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/green-hub", greenHubRoutes);
app.use("/api/impact", impactRoutes);
app.use("/api/waitlist", waitlistRoutes);
app.use("/api/partners", partnerRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/ai", require("./routes/ai.routes"));
app.use("/api/journeys", require("./routes/journeys.routes"));
app.use("/api", require("./routes/recommendations.routes"));

// Development-only: exposes the mail outbox so password-reset links can be
// followed without a mail provider. Deliberately absent in production.
if (!isProduction) {
  app.use("/api/dev", require("./routes/dev.routes"));
}

// 404 handler
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// Central error handler — never leak stack traces or internals in production
app.use((err, req, res, next) => {
  // Postgres unique-violation: the row already exists.
  if (err && err.code === "23505") {
    return res.status(409).json({ error: "That record already exists" });
  }
  // Postgres invalid text representation — e.g. a malformed uuid in the path.
  if (err && err.code === "22P02") {
    return res.status(400).json({ error: "Invalid request" });
  }
  // A rejected upload is the client's problem, not an internal error.
  if (err && err.name === "MulterError") {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({
      error: err.code === "LIMIT_FILE_SIZE" ? "The image is larger than the allowed size" : "Invalid upload",
    });
  }

  const status = err.status || 500;
  // Client errors are expected and handled; only unexpected failures are worth
  // a stack trace, which also keeps test output readable.
  if (status >= 500) console.error(err);

  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
});

const PORT = process.env.PORT || 4000;

/** A placeholder or missing JWT secret in production would let anyone mint
 * valid tokens, so refuse to start rather than run insecurely. */
function assertProductionConfig() {
  if (!isProduction) return;

  const secret = process.env.JWT_SECRET || "";
  if (!secret || secret === "dev-secret" || secret === "replace-with-a-long-random-string") {
    throw new Error(
      "JWT_SECRET must be set to a strong, unique value in production (see .env.example)"
    );
  }
}

// Exported so tests can mount the app on an ephemeral port without the boot
// sequence below running.
module.exports = app;

if (require.main === module) {
  // Fail fast at boot with a readable message instead of a stack trace on every
  // request. The admin account comes from `npm run seed`, not from boot.
  Promise.resolve()
    .then(() => assertProductionConfig())
    .then(() => assertConfigured())
    .then(() => ping())
    .then(() => {
      const server = app.listen(PORT, () => console.log(`Greenomy API listening on port ${PORT}`));
      // A port clash surfaces as an event, not a throw — without this it would
      // crash with a bare stack trace.
      server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.error(`\nPort ${PORT} is already in use.`);
          console.error("Stop whatever is using it, or start with a different port, e.g. PORT=4001 npm start\n");
        } else {
          console.error(`\nThe API could not start: ${err.message}\n`);
        }
        process.exit(1);
      });
    })
    .catch((err) => {
      console.error(`\nCannot start: ${err.message}`);
      console.error("Check the database is running and DATABASE_URL is correct, then run:");
      console.error("  npm run migrate && npm run seed\n");
      process.exit(1);
    });
}
