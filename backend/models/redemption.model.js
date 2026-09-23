// models/redemption.model.js
const { query } = require("../config/db");

/** Must run inside withTransaction, alongside the points deduction + ledger row. */
async function create(client, { userId, rewardId, partnerId, pointsSpent, token, expiresAt }) {
  const { rows } = await client.query(
    `INSERT INTO redemptions
       (user_id, reward_id, partner_id, points_spent, redemption_token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, rewardId, partnerId || null, pointsSpent, token, expiresAt]
  );
  return rows[0];
}

async function findByToken(token) {
  const { rows } = await query(
    "SELECT * FROM redemptions WHERE redemption_token = $1",
    [token]
  );
  return rows[0] || null;
}

/** Single-use: only an unused, unexpired code can be consumed, and the
 * `is_used = false` predicate makes that atomic even under a double scan. */
async function consumeByToken(client, token) {
  const { rows } = await client.query(
    `UPDATE redemptions
        SET is_used = true,
            used_at = now()
      WHERE redemption_token = $1
        AND is_used = false
        AND expires_at > now()
      RETURNING *`,
    [token]
  );
  return rows[0] || null;
}

module.exports = { create, findByToken, consumeByToken };
