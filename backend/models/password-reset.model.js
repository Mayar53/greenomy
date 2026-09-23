// models/password-reset.model.js
const { query } = require("../config/db");

/** Must run inside withTransaction when paired with a password change. */
async function create(client, { userId, tokenHash, expiresAt }) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, tokenHash, expiresAt]
  );
  return rows[0];
}

/** Only an unused, unexpired token counts as valid. */
async function findValidByHash(tokenHash) {
  const { rows } = await query(
    `SELECT * FROM password_resets
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function markUsed(client, resetId) {
  const run = client ? client.query.bind(client) : query;
  await run("UPDATE password_resets SET used_at = now() WHERE reset_id = $1", [resetId]);
}

/** Supersedes any other outstanding links for the user — requesting a new reset
 * invalidates the previous one. */
async function invalidateForUser(userId, client) {
  const run = client ? client.query.bind(client) : query;
  const { rowCount } = await run(
    "UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
    [userId]
  );
  return rowCount;
}

module.exports = { create, findValidByHash, markUsed, invalidateForUser };
