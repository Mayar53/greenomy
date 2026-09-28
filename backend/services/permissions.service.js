// services/permissions.service.js — the catalogue of what an admin may do.
//
// One list, in one place: the guards check it, the API validates grants against
// it, and the dashboard renders its checkboxes from it. Adding a capability means
// adding a key here and guarding the route with it — nowhere else.
//
// This is not a second source of truth for the ROLE. Role decides whether you are
// staff at all (`requireRole`); permissions decide which parts of the dashboard
// you may touch (`requirePermission`).
const PERMISSIONS = {
  "users.manage": "View members and change their role or status",
  "admins.manage": "Add admins, and change what they may do",
  "verifications.review": "Approve or reject submitted photos",
  "rewards.manage": "Create and edit rewards",
  "partners.manage": "Create and edit partner businesses",
  "content.manage": "Write and publish Green Hub articles",
  "analytics.view": "See the dashboard's numbers",
};

/** Catalogue order, which is also the order the checkboxes render in. */
const KEYS = Object.keys(PERMISSIONS);
const ALL = [...KEYS];

function isKnown(key) {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, key);
}

/** Known keys only, de-duplicated, in catalogue order. */
function sanitize(list) {
  if (!Array.isArray(list)) return [];
  const wanted = new Set(list.filter((key) => typeof key === "string" && isKnown(key)));
  return KEYS.filter((key) => wanted.has(key));
}

/** What this account actually holds. super_admin holds everything: it is the
 * owner account and the way back in if a grant is wrong. */
function heldBy(user) {
  if (!user) return [];
  if (user.role === "super_admin") return ALL;
  return sanitize(user.permissions);
}

function can(user, permission) {
  return heldBy(user).includes(permission);
}

/* ------------------------------------------------------------------ owner -- */
/* The owner is the seeded super_admin (ADMIN_SEED_EMAIL, e.g. mayarraws@gmail.com).
 * It is THE admin: it holds every permission, it is the account that can repair a
 * bad grant, and nothing may ever demote, suspend or lock it out — otherwise the
 * deployment could be left with no way back in. That guarantee is defined once,
 * here, and every write path asks this module rather than re-deciding. */

const OWNER_ROLE = "super_admin";

/** Role strength, so "promotable but never demotable" is a single comparison. */
const ROLE_RANK = { user: 0, admin: 1, super_admin: 2 };

/** Matched by role AND by the configured seed email: even if the role were
 * changed through some future path, the seeded account is still the owner. */
function isOwner(user) {
  if (!user) return false;
  if (user.role === OWNER_ROLE) return true;
  const ownerEmail = String(process.env.ADMIN_SEED_EMAIL || "").trim().toLowerCase();
  return Boolean(ownerEmail) && String(user.email || "").trim().toLowerCase() === ownerEmail;
}

/**
 * Why a change to `user` must be refused, or null. The owner may only ever move
 * UP (never be demoted) and must stay active, so no one — not even another
 * admin, not even the owner — can lock out the account that can fix a bad grant.
 */
function ownerChangeProblem(user, { role, status } = {}) {
  if (!isOwner(user)) return null;

  if (status !== undefined && status !== null && status !== "active") {
    return "The owner account cannot be suspended";
  }

  if (role !== undefined && role !== null) {
    const wanted = ROLE_RANK[role];
    const current = ROLE_RANK[user.role] ?? 0;
    if (wanted === undefined || (role !== user.role && wanted < current)) {
      return "The owner account cannot be demoted";
    }
  }

  return null;
}

module.exports = {
  PERMISSIONS,
  KEYS,
  ALL,
  isKnown,
  sanitize,
  heldBy,
  can,
  OWNER_ROLE,
  ROLE_RANK,
  isOwner,
  ownerChangeProblem,
};
