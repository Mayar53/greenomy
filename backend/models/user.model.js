// models/user.model.js
const { query } = require("../config/db");

// password_hash is deliberately never selected by the public helpers.
const PUBLIC_COLUMNS =
  "user_id, full_name, email, city, total_points, lifetime_xp, care_streak_days, care_streak_last, role, status, permissions, experience, plant_types, interests, created_at, updated_at";

/** Email is matched case-insensitively: an address is one account, whatever
 * case it was typed in. Used by login, signup's "already exists" check, the
 * password-reset flow and admin promotion-by-email, so they all agree. */
async function findByEmail(email) {
  const { rows } = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [String(email || "").trim()]);
  return rows[0] || null;
}

async function findById(userId) {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function create({ fullName, email, passwordHash, city, role = "user" }) {
  // Stored lower-cased and trimmed, so one address is always one row — the
  // case-insensitive unique index in migration 012 relies on this.
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const { rows } = await query(
    `INSERT INTO users (full_name, email, password_hash, city, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${PUBLIC_COLUMNS}`,
    [fullName, normalizedEmail, passwordHash, city || null, role]
  );
  return rows[0];
}

/**
 * Partial update — a missing field leaves the column untouched.
 *
 * `experience`, `plantTypes` and `interests` are the preferences the onboarding
 * wizard collects (and used to throw away). They are only written when sent, so
 * the profile form can still PATCH just a name or city.
 */
async function updateProfile(userId, { fullName, city, experience, plantTypes, interests }) {
  const { rows } = await query(
    `UPDATE users
        SET full_name   = COALESCE($2, full_name),
            city        = COALESCE($3, city),
            experience  = COALESCE($4, experience),
            plant_types = COALESCE($5, plant_types),
            interests   = COALESCE($6, interests),
            updated_at  = now()
      WHERE user_id = $1
      RETURNING ${PUBLIC_COLUMNS}`,
    [
      userId,
      fullName || null,
      city || null,
      experience || null,
      Array.isArray(plantTypes) ? plantTypes : null,
      Array.isArray(interests) ? interests : null,
    ]
  );
  return rows[0] || null;
}

/** Must run inside withTransaction — always paired with a ledger row. */
async function addPoints(client, userId, amount) {
  const { rows } = await client.query(
    `UPDATE users
        SET total_points = total_points + $2,
            updated_at   = now()
      WHERE user_id = $1
      RETURNING total_points`,
    [userId, amount]
  );
  return rows[0] ? rows[0].total_points : null;
}

/**
 * Adds lifetime garden XP. Must run inside withTransaction with the reward
 * grant. XP is derived currency — it is never spent, so it has no ledger of its
 * own; the reward_grants row is the record of why it changed.
 */
async function addXp(client, userId, amount) {
  const { rows } = await client.query(
    `UPDATE users
        SET lifetime_xp = GREATEST(lifetime_xp + $2, 0),
            updated_at  = now()
      WHERE user_id = $1
      RETURNING lifetime_xp`,
    [userId, amount]
  );
  return rows[0] ? rows[0].lifetime_xp : null;
}

/** Records the member's current care streak and the day it was last advanced. */
async function setCareStreak(client, userId, days, lastDate) {
  const { rows } = await client.query(
    `UPDATE users
        SET care_streak_days = $2,
            care_streak_last = $3,
            updated_at = now()
      WHERE user_id = $1
      RETURNING care_streak_days, care_streak_last`,
    [userId, days, lastDate]
  );
  return rows[0] || null;
}

/** Locks the balance row for the duration of a redemption transaction. */
async function lockForUpdate(client, userId) {
  const { rows } = await client.query(
    "SELECT user_id, total_points FROM users WHERE user_id = $1 FOR UPDATE",
    [userId]
  );
  return rows[0] || null;
}

async function count() {
  const { rows } = await query("SELECT count(*)::int AS n FROM users");
  return rows[0].n;
}

/** Includes the hash — for password verification only, never sent to clients. */
async function findByIdWithHash(userId) {
  const { rows } = await query("SELECT * FROM users WHERE user_id = $1", [userId]);
  return rows[0] || null;
}

/** Pass a client to run inside withTransaction (password + reset-token updates
 * must land together). */
async function updatePassword(client, userId, passwordHash) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `UPDATE users
        SET password_hash = $2,
            updated_at    = now()
      WHERE user_id = $1
      RETURNING user_id`,
    [userId, passwordHash]
  );
  return rows[0] || null;
}

/** Admin user list — newest first, still without password hashes.
 *
 * `search` narrows by name, email or city: case-insensitive and partial, so a
 * few letters of either is enough. Omitting it returns the whole list, which is
 * what this always did. */
async function listAll({ search } = {}) {
  const term = String(search == null ? "" : search).trim();
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM users
      WHERE $1::text IS NULL
         OR full_name ILIKE '%' || $1 || '%'
         OR email     ILIKE '%' || $1 || '%'
         OR city      ILIKE '%' || $1 || '%'
      ORDER BY created_at DESC`,
    [term || null]
  );
  return rows;
}

/** The busiest members, most active first — for the dashboard's own ranking.
 *
 * Activity is what the product asks of a member: documenting their plants. So it
 * counts photos submitted first, then plants grown; a member with no plants or
 * photos stays in the list, at the bottom, rather than vanishing from it. */
async function listMostActive({ limit = 10 } = {}) {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS},
            (SELECT count(*)::int FROM verifications v WHERE v.user_id = users.user_id) AS verifications_count,
            (SELECT count(*)::int FROM plants p        WHERE p.user_id = users.user_id) AS plants_count
       FROM users
      ORDER BY verifications_count DESC, plants_count DESC, created_at ASC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Admin edit: role, status, name and city. Partial — omitted fields are left
 * alone, so a form that only sends a status cannot blank a name. */
async function updateAdmin(userId, { role, status, fullName, city }) {
  const { rows } = await query(
    `UPDATE users
        SET role       = COALESCE($2, role),
            status     = COALESCE($3, status),
            full_name  = COALESCE($4, full_name),
            city       = COALESCE($5, city),
            updated_at = now()
      WHERE user_id = $1
      RETURNING ${PUBLIC_COLUMNS}`,
    [userId, role || null, status || null, fullName || null, city || null]
  );
  return rows[0] || null;
}

/** Staff, for the admin-management screen. */
async function listAdmins() {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM users
      WHERE role IN ('admin', 'super_admin')
      ORDER BY role DESC, email`
  );
  return rows;
}

/**
 * Sets an admin's role and permission list.
 *
 * The list is sent whole rather than patched, so unticking a box really removes
 * that capability (an empty array clears it — COALESCE only skips a null).
 */
async function setAdminAccess(userId, { role, permissions }) {
  const { rows } = await query(
    `UPDATE users
        SET role        = COALESCE($2, role),
            permissions = COALESCE($3, permissions),
            updated_at  = now()
      WHERE user_id = $1
      RETURNING ${PUBLIC_COLUMNS}`,
    [userId, role || null, Array.isArray(permissions) ? permissions : null]
  );
  return rows[0] || null;
}

module.exports = {
  findByEmail,
  findById,
  findByIdWithHash,
  create,
  updateProfile,
  updatePassword,
  addPoints,
  addXp,
  setCareStreak,
  lockForUpdate,
  count,
  listAll,
  listMostActive,
  updateAdmin,
  listAdmins,
  setAdminAccess,
};
