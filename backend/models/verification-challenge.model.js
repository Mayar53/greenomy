// models/verification-challenge.model.js — the per-attempt code the member must
// show in their photo. Never static, short-lived, single-use.
const { query } = require("../config/db");

const COLUMNS = "challenge_id, user_id, plant_id, code, issued_at, expires_at, used_at, instruction";

async function issue({ userId, plantId, code, expiresAt, instruction }) {
  const { rows } = await query(
    `INSERT INTO verification_challenges (user_id, plant_id, code, expires_at, instruction)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [userId, plantId || null, code, expiresAt, instruction || null]
  );
  return rows[0];
}

async function findById(challengeId) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM verification_challenges WHERE challenge_id = $1`, [
    challengeId,
  ]);
  return rows[0] || null;
}

/** The newest still-usable challenge for a member (and plant, if given). */
async function findActive(userId, plantId) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM verification_challenges
      WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
        ${plantId ? "AND plant_id = $2" : ""}
      ORDER BY issued_at DESC LIMIT 1`,
    plantId ? [userId, plantId] : [userId]
  );
  return rows[0] || null;
}

/**
 * Consumes a challenge atomically. The authority is the conditional UPDATE:
 * `used_at IS NULL AND expires_at > now()` means two simultaneous submissions
 * with the same code resolve to exactly one winner, and an expired code can
 * never be used. Returns null when the challenge is not usable.
 */
async function consume(client, challengeId, userId) {
  const { rows } = await client.query(
    `UPDATE verification_challenges
        SET used_at = now()
      WHERE challenge_id = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING ${COLUMNS}`,
    [challengeId, userId]
  );
  return rows[0] || null;
}

module.exports = { issue, findById, findActive, consume };
