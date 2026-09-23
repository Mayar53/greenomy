// controllers/auth.controller.js
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { withTransaction } = require("../config/db");
const userModel = require("../models/user.model");
const passwordResetModel = require("../models/password-reset.model");
const { sendMail } = require("../services/mail.service");

// Server-side validation is authoritative — the client checks are UX only.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESET_TTL_MINUTES = 30;
const RESET_TTL_MS = RESET_TTL_MINUTES * 60 * 1000;

function passwordProblem(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (!/[A-Za-z]/.test(password)) return "Password must include a letter";
  if (!/[0-9]/.test(password)) return "Password must include a number";
  return null;
}

function signToken(user) {
  return jwt.sign({ id: user.user_id, role: user.role }, process.env.JWT_SECRET || "dev-secret", {
    expiresIn: "7d",
  });
}

/** Only the hash is stored, so a database leak yields no usable reset links. */
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const appBaseUrl = () => (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

exports.signup = async (req, res) => {
  const { fullName, email, password, city } = req.body || {};
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "fullName, email, and password are required" });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email address" });
  }
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const existing = await userModel.findByEmail(email);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await userModel.create({ fullName, email, passwordHash, city });
  res.status(201).json({ user, token: signToken(user) });
};

exports.login = async (req, res) => {
  const { email, password } = req.body || {};
  const user = await userModel.findByEmail(email);
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const match = await bcrypt.compare(password || "", user.password_hash);
  if (!match) return res.status(401).json({ error: "Invalid email or password" });

  // Refuse a suspended account up front rather than issuing a token that
  // requireAuth would immediately reject.
  if (user.status !== "active") {
    return res.status(403).json({ error: "This account is suspended" });
  }

  const { password_hash: _omit, ...safeUser } = user;
  res.json({ user: safeUser, token: signToken(user) });
};

exports.logout = (req, res) => {
  // Stateless JWT: logout is handled client-side by discarding the token.
  // If refresh-token sessions are added later, revoke them here.
  res.json({ success: true });
};

exports.me = async (req, res) => {
  const user = await userModel.findById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body || {};
  const generic = { message: "If that email exists, a reset link has been sent." };

  // A missing email gets the same response: the endpoint must not reveal which
  // addresses have accounts.
  if (!email) return res.json(generic);

  const user = await userModel.findByEmail(email);
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");

    // Requesting a new link supersedes any previous one.
    await passwordResetModel.invalidateForUser(user.user_id);
    await passwordResetModel.create(null, {
      userId: user.user_id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(),
    });

    const link = `${appBaseUrl()}/reset-password.html?token=${token}`;
    await sendMail({
      to: email,
      subject: "Reset your Greenomy password",
      text: [
        `Hi ${user.full_name},`,
        "",
        "Someone asked to reset the password for this Greenomy account.",
        `The link below is valid for ${RESET_TTL_MINUTES} minutes and can only be used once.`,
        "",
        link,
        "",
        "If this wasn't you, you can safely ignore this email — your password is unchanged.",
      ].join("\n"),
    });
  }

  res.json(generic);
};

exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: "token and newPassword are required" });
  }
  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  const record = await passwordResetModel.findValidByHash(hashToken(token));
  if (!record) {
    return res.status(400).json({ error: "This reset link is invalid or has expired" });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await withTransaction(async (client) => {
    await userModel.updatePassword(client, record.user_id, passwordHash);
    await passwordResetModel.markUsed(client, record.reset_id);
  });

  res.json({ success: true });
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  const user = await userModel.findByIdWithHash(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const match = await bcrypt.compare(currentPassword, user.password_hash);
  // 400, not 401: a wrong current password is a validation failure, and 401
  // would be indistinguishable from an expired session to the client.
  if (!match) return res.status(400).json({ error: "Current password is incorrect" });
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "The new password must be different" });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await userModel.updatePassword(null, user.user_id, passwordHash);
  // Outstanding reset links are moot once the password has changed.
  await passwordResetModel.invalidateForUser(user.user_id);

  res.json({ success: true });
};
