// middleware/auth.middleware.js — JWT verification and role-based guards.
// Frontend role checks are for UX only; every protected route re-checks here.
const jwt = require("jsonwebtoken");
const userModel = require("../models/user.model");
const permissions = require("../services/permissions.service");

/**
 * Verifies the bearer token, then loads the account so that role and status
 * come from the database rather than the token. A suspended or demoted account
 * therefore stops working immediately instead of when its 7-day token expires.
 *
 * Written as an async function that handles its own rejections, so it can be
 * passed to router.use()/router.get() directly on Express 4.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const user = await userModel.findById(payload.id);
    if (!user) return res.status(401).json({ error: "Invalid or expired token" });
    if (user.status !== "active") {
      return res.status(403).json({ error: "This account is suspended" });
    }

    req.user = { id: user.user_id, role: user.role, permissions: user.permissions || [] };
    next();
  } catch (err) {
    next(err);
  }
}

/** Are you staff at all? */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

/**
 * May you touch this part of the dashboard? Read from the DATABASE (via
 * requireAuth) on every request, so revoking a permission takes effect on the
 * next call rather than when the token expires. super_admin passes everything.
 */
function requirePermission(...needed) {
  return (req, res, next) => {
    if (!req.user || !needed.every((permission) => permissions.can(req.user, permission))) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requirePermission };
