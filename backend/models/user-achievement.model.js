// models/user-achievement.model.js — who unlocked which achievement.
// The unique key is what makes an unlock happen exactly once.
const { query } = require("../config/db");

/** Must run inside withTransaction with the reward grant. Returns null when the
 * achievement was already unlocked. */
async function unlock(client, { userId, achievementId }) {
  const { rows } = await client.query(
    `INSERT INTO user_achievements (user_id, achievement_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, achievement_id) DO NOTHING
     RETURNING id, user_id, achievement_id, unlocked_at`,
    [userId, achievementId]
  );
  return rows[0] || null;
}

async function listForUser(userId, client) {
  const executor = client ? client.query.bind(client) : query;
  const { rows } = await executor(
    "SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = $1 ORDER BY unlocked_at DESC",
    [userId]
  );
  return rows;
}

async function count(userId, client) {
  const executor = client ? client.query.bind(client) : query;
  const { rows } = await executor(
    "SELECT count(*)::int AS n FROM user_achievements WHERE user_id = $1",
    [userId]
  );
  return rows[0].n;
}

module.exports = { unlock, listForUser, count };
