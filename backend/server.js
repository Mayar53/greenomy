// server.js — Greenomy REST API entrypoint
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/users.routes");
const plantRoutes = require("./routes/plants.routes");
const verificationRoutes = require("./routes/verifications.routes");
const adminVerificationRoutes = require("./routes/admin-verifications.routes");
const rewardRoutes = require("./routes/rewards.routes");
const walletRoutes = require("./routes/wallet.routes");
const greenHubRoutes = require("./routes/green-hub.routes");
const impactRoutes = require("./routes/impact.routes");
const waitlistRoutes = require("./routes/waitlist.routes");
const partnerRoutes = require("./routes/partners.routes");
const notificationRoutes = require("./routes/notifications.routes");

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: true }));
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
app.use("/api/rewards", rewardRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/green-hub", greenHubRoutes);
app.use("/api/impact", impactRoutes);
app.use("/api/waitlist", waitlistRoutes);
app.use("/api/partners", partnerRoutes);
app.use("/api/notifications", notificationRoutes);

// 404 handler
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// Central error handler — never leak stack traces or internals in production
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Greenomy API listening on port ${PORT}`));
