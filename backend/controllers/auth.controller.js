// controllers/auth.controller.js
// NOTE: demo-mode in-memory implementation. Production version replaces
// the mock-data store with PostgreSQL queries via models/user.model.js.
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../database/mock-data");

function signToken(user) {
  return jwt.sign({ id: user.user_id, role: user.role }, process.env.JWT_SECRET || "dev-secret", {
    expiresIn: "7d",
  });
}

exports.signup = async (req, res) => {
  const { fullName, email, password, city } = req.body || {};
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "fullName, email, and password are required" });
  }
  if (db.users.find((u) => u.email === email)) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const password_hash = await bcrypt.hash(password, 12);
  const user = {
    user_id: `u_${Date.now()}`,
    full_name: fullName,
    email,
    password_hash,
    city: city || null,
    total_points: 0,
    role: "user",
    status: "active",
    created_at: new Date().toISOString(),
  };
  db.users.push(user);

  const token = signToken(user);
  const { password_hash: _omit, ...safeUser } = user;
  res.status(201).json({ user: safeUser, token });
};

exports.login = async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const match = await bcrypt.compare(password || "", user.password_hash);
  if (!match) return res.status(401).json({ error: "Invalid email or password" });

  const token = signToken(user);
  const { password_hash: _omit, ...safeUser } = user;
  res.json({ user: safeUser, token });
};

exports.logout = (req, res) => {
  // Stateless JWT: logout is handled client-side by discarding the token.
  // If refresh-token sessions are added later, revoke them here.
  res.json({ success: true });
};

exports.me = (req, res) => {
  const user = db.users.find((u) => u.user_id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const { password_hash: _omit, ...safeUser } = user;
  res.json(safeUser);
};

exports.forgotPassword = (req, res) => {
  // Always respond generically to avoid leaking which emails are registered.
  res.json({ message: "If that email exists, a reset link has been sent." });
};

exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: "token and newPassword are required" });
  // Production: verify the reset token record, then update password_hash.
  res.json({ success: true });
};
