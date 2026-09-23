// models/point-transaction.model.js
const { query } = require("../config/db");

/** Must run inside withTransaction, together with the users.total_points update. */
async function create(client, { userId, amount, transactionType, referenceId, description }) {
  const { rows } = await client.query(
    `INSERT INTO point_transactions
       (user_id, amount, transaction_type, reference_id, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, amount, transactionType, referenceId || null, description || null]
  );
  return rows[0];
}

async function listByUser(userId) {
  const { rows } = await query(
    "SELECT * FROM point_transactions WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows;
}

/** Signed sums powering GET /wallet. */
async function totalsForUser(userId) {
  const { rows } = await query(
    `SELECT
        COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::int AS earned,
        COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0)::int AS spent
       FROM point_transactions
      WHERE user_id = $1`,
    [userId]
  );
  return rows[0];
}

module.exports = { create, listByUser, totalsForUser };
