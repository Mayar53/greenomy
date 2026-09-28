// models/user-challenge.model.js — a member's progress on a seasonal challenge.
// The requirement is always re-derived from real activity; `progress` here is
// only a cached snapshot for display.
const { query } = require("../config/db");

const COLUMNS = "id, user_id, challenge_id, progress, completed_at, claimed_at, updated_at";

const run = (client) => (client ? client.query.bind(client) : query);

/** Stores the latest snapshot. progress only ever moves forward; completed_at
 * is stamped the first time the requirement is met. */
async function upsertProgress(client, { userId, challengeId, progress, completedAt }) {
  const { rows } = await client.query(
    `INSERT INTO user_challenges (user_id, challenge_id, progress, completed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, challenge_id) DO UPDATE
       SET progress = GREATEST(user_challenges.progress, EXCLUDED.progress),
           completed_at = COALESCE(user_challenges.completed_at, EXCLUDED.completed_at),
           updated_at = now()
     RETURNING ${COLUMNS}`,
    [userId, challengeId, progress, completedAt || null]
  );
  return rows[0] || null;
}

/** Claims a completed challenge exactly once. Returns null when it is not
 * complete, or the reward was already claimed. */
async function claim(client, userId, challengeId) {
  const { rows } = await client.query(
    `UPDATE user_challenges
        SET claimed_at = now(), updated_at = now()
      WHERE user_id = $1 AND challenge_id = $2
        AND completed_at IS NOT NULL AND claimed_at IS NULL
      RETURNING ${COLUMNS}`,
    [userId, challengeId]
  );
  return rows[0] || null;
}

async function find(userId, challengeId, client) {
  const { rows } = await run(client)(
    `SELECT ${COLUMNS} FROM user_challenges WHERE user_id = $1 AND challenge_id = $2`,
    [userId, challengeId]
  );
  return rows[0] || null;
}

async function listForUser(userId, client) {
  const { rows } = await run(client)(
    `SELECT ${COLUMNS} FROM user_challenges WHERE user_id = $1`,
    [userId]
  );
  return rows;
}

async function countCompleted(userId, client) {
  const { rows } = await run(client)(
    "SELECT count(*)::int AS n FROM user_challenges WHERE user_id = $1 AND completed_at IS NOT NULL",
    [userId]
  );
  return rows[0].n;
}

module.exports = { upsertProgress, claim, find, listForUser, countCompleted };
