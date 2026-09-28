// models/reward-grant.model.js — the idempotency ledger for engagement rewards.
//
// Every milestone, achievement, streak and challenge reward records one row
// here. The UNIQUE (user_id, grant_type, reference_id) key is the whole point:
// a replayed request returns no row and pays nothing. A mystery grant is created
// 'pending' and only flips to 'claimed' once — the WHERE status = 'pending'
// guard means a second claim changes nothing.
const { query } = require("../config/db");

const COLUMNS =
  "grant_id, user_id, grant_type, reference_id, source_plant_id, mystery, status, pool, payload, xp, created_at, claimed_at";

const run = (client) => (client ? client.query.bind(client) : query);

/** Must run inside withTransaction with the XP/item updates. Returns null when
 * this grant already exists. */
async function create(client, { userId, grantType, referenceId, sourcePlantId, mystery, pool, payload, xp }) {
  const { rows } = await client.query(
    `INSERT INTO reward_grants
       (user_id, grant_type, reference_id, source_plant_id, mystery, status, pool, payload, xp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, grant_type, reference_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      userId,
      grantType,
      referenceId,
      sourcePlantId || null,
      mystery === true,
      mystery === true ? "pending" : "granted",
      pool || null,
      payload ? JSON.stringify(payload) : null,
      xp || 0,
    ]
  );
  return rows[0] || null;
}

/** Claims a pending mystery grant exactly once, storing what it turned into. */
async function claim(client, grantId, { payload, xp }) {
  const { rows } = await client.query(
    `UPDATE reward_grants
        SET status = 'claimed', payload = $2, xp = $3, claimed_at = now()
      WHERE grant_id = $1 AND status = 'pending'
      RETURNING ${COLUMNS}`,
    [grantId, payload ? JSON.stringify(payload) : null, xp || 0]
  );
  return rows[0] || null;
}

async function findForUser(grantId, userId, client) {
  const { rows } = await run(client)(
    `SELECT ${COLUMNS} FROM reward_grants WHERE grant_id = $1 AND user_id = $2`,
    [grantId, userId]
  );
  return rows[0] || null;
}

async function listPending(userId, client) {
  const { rows } = await run(client)(
    `SELECT ${COLUMNS} FROM reward_grants
      WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

async function listRecent(userId, { limit = 8 } = {}, client) {
  const { rows } = await run(client)(
    `SELECT ${COLUMNS} FROM reward_grants
      WHERE user_id = $1 AND status <> 'pending'
      ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function countClaimedMysteries(userId, client) {
  const { rows } = await run(client)(
    `SELECT count(*)::int AS n FROM reward_grants
      WHERE user_id = $1 AND mystery = true AND status = 'claimed'`,
    [userId]
  );
  return rows[0].n;
}

module.exports = {
  create,
  claim,
  findForUser,
  listPending,
  listRecent,
  countClaimedMysteries,
};
