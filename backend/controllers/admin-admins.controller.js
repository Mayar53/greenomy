// controllers/admin-admins.controller.js — who is an admin, and what they may do.
//
// Promotion is by EMAIL: the person must already have an account, so there is no
// half-created staff row and no invitation token to keep in sync. Granting is
// explicit — the checkbox list IS the permission list, and an empty list means an
// admin who can sign in but touch nothing.
//
// Every call here needs `admins.manage`, and four rules stop the obvious abuses:
//   * you cannot edit yourself, so nobody can quietly widen their own access;
//   * the owner (super_admin) is not editable, so the account that can fix a bad
//     grant cannot be locked out by one;
//   * you cannot grant a capability you do not hold yourself;
//   * unknown permission keys are refused rather than silently dropped, so a typo
//     is a 400 and not a mystery.
const userModel = require("../models/user.model");
const permissions = require("../services/permissions.service");

function shape(user) {
  return {
    id: user.user_id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    status: user.status,
    permissions: permissions.heldBy(user),
  };
}

/** The catalogue the dashboard renders its checkboxes from, plus what the caller
 * holds — the UI should not offer a capability the API would refuse. */
exports.catalogue = (req, res) => {
  res.json({ catalogue: permissions.PERMISSIONS, mine: permissions.heldBy(req.user) });
};

exports.list = async (req, res) => {
  res.json((await userModel.listAdmins()).map(shape));
};

/** Refuses unknown keys and returns the sanitised list. */
function readPermissions(body) {
  const wanted = Array.isArray(body.permissions) ? body.permissions : [];
  const unknown = wanted.filter((key) => !permissions.isKnown(key));
  if (unknown.length) {
    return { error: `Unknown permission(s): ${unknown.join(", ")}` };
  }
  return { list: permissions.sanitize(wanted) };
}

/** Nothing may grant what it does not hold itself. */
function refuseEscalation(actor, list) {
  const beyond = list.filter((key) => !permissions.can(actor, key));
  if (beyond.length) {
    return `You cannot grant permission(s) you do not hold: ${beyond.join(", ")}`;
  }
  return null;
}

exports.create = async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email is required" });

  const { list, error } = readPermissions(body);
  if (error) return res.status(400).json({ error });

  const escalation = refuseEscalation(req.user, list);
  if (escalation) return res.status(403).json({ error: escalation });

  const person = await userModel.findByEmail(email);
  if (!person) {
    return res.status(404).json({ error: "No account with that email — they need to sign up first" });
  }
  if (permissions.isOwner(person)) {
    return res.status(409).json({ error: "That account is the owner and already holds every permission" });
  }

  const updated = await userModel.setAdminAccess(person.user_id, { role: "admin", permissions: list });
  res.status(201).json(shape(updated));
};

exports.update = async (req, res) => {
  const body = req.body || {};
  const { list, error } = readPermissions(body);
  if (error) return res.status(400).json({ error });

  if (req.params.id === req.user.id) {
    return res.status(409).json({ error: "You cannot change your own access" });
  }

  const escalation = refuseEscalation(req.user, list);
  if (escalation) return res.status(403).json({ error: escalation });

  const target = await userModel.findById(req.params.id);
  if (!target) return res.status(404).json({ error: "Admin not found" });
  if (target.role === "user") return res.status(404).json({ error: "Admin not found" });
  if (permissions.isOwner(target)) {
    return res.status(403).json({ error: "The owner account cannot be changed" });
  }

  const updated = await userModel.setAdminAccess(target.user_id, { role: "admin", permissions: list });
  res.json(shape(updated));
};

/** Demotion, not deletion: the account and its history stay, it just stops being
 * staff. Same self and owner rules as an edit. */
exports.remove = async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(409).json({ error: "You cannot remove your own access" });
  }

  const target = await userModel.findById(req.params.id);
  if (!target || target.role === "user") return res.status(404).json({ error: "Admin not found" });
  if (permissions.isOwner(target)) {
    return res.status(403).json({ error: "The owner account cannot be changed" });
  }

  const updated = await userModel.setAdminAccess(target.user_id, { role: "user", permissions: [] });
  res.json(shape(updated));
};
