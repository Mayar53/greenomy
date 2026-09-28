// models/user-boost.model.js — temporary XP multipliers (XP boosts).
const { query } = require("../config/db");

const COLUMNS = "boost_id, user_id, multiplier, source_reference, expires_at, created_at";

/** Must run inside withTransaction. Idempotent per source reference, so the same
 * reward cannot stack itself. */
async function create(client, { userId, multiplier = 1.5, sourceReference, hours = 24 }) {
  const { rows } = await client.query(
    `INSERT INTO user_boosts (user_id, multiplier, source_reference, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)
     ON CONFLICT (user_id, source_reference) DO NOTHING
     RETURNING ${COLUMNS}`,
    [userId, multiplier, sourceReference, String(hours)]
  );
  return rows[0] || null;
}

/** The strongest boost that is still live, or null. */
async function activeForUser(userId, client) {
  const executor = client ? client.query.bind(client) : query;
  const { rows } = await executor(
    `SELECT ${COLUMNS} FROM user_boosts
      WHERE user_id = $1 AND expires_at > now()
      ORDER BY multiplier DESC, expires_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

module.exports = { create, activeForUser };
