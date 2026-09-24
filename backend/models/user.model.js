// models/user.model.js
const { query } = require("../config/db");

// password_hash is deliberately never selected by the public helpers.
const PUBLIC_COLUMNS =
  "user_id, full_name, email, city, total_points, role, status, experience, plant_types, interests, created_at, updated_at";

/** Used by login only — the one place that needs the hash. */
async function findByEmail(email) {
  const { rows } = await query("SELECT * FROM users WHERE email = $1", [email]);
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
  const { rows } = await query(
    `INSERT INTO users (full_name, email, password_hash, city, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${PUBLIC_COLUMNS}`,
    [fullName, email, passwordHash, city || null, role]
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

/** Admin user list — newest first, still without password hashes. */
async function listAll() {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at DESC`
  );
  return rows;
}

/** Admin edit: role and/or status. Partial — omitted fields are left alone. */
async function updateAdmin(userId, { role, status }) {
  const { rows } = await query(
    `UPDATE users
        SET role       = COALESCE($2, role),
            status     = COALESCE($3, status),
            updated_at = now()
      WHERE user_id = $1
      RETURNING ${PUBLIC_COLUMNS}`,
    [userId, role || null, status || null]
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
  lockForUpdate,
  count,
  listAll,
  updateAdmin,
};
