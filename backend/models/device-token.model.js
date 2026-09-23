// models/device-token.model.js
const { query } = require("../config/db");

/** Upsert: a device that re-registers just refreshes its last_seen_at. */
async function register({ userId, token, platform }) {
  const { rows } = await query(
    `INSERT INTO device_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE
       SET user_id      = EXCLUDED.user_id,
           platform     = EXCLUDED.platform,
           last_seen_at = now()
     RETURNING *`,
    [userId, token, platform || "web"]
  );
  return rows[0];
}

async function listByUser(userId) {
  const { rows } = await query(
    "SELECT * FROM device_tokens WHERE user_id = $1",
    [userId]
  );
  return rows;
}

async function remove(token) {
  const { rowCount } = await query("DELETE FROM device_tokens WHERE token = $1", [token]);
  return rowCount > 0;
}

module.exports = { register, listByUser, remove };
