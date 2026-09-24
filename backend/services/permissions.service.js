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

module.exports = { PERMISSIONS, KEYS, ALL, isKnown, sanitize, heldBy, can };
