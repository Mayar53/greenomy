// models/care-action.model.js — a member's recorded plant-care actions.
// The only place care_actions SQL lives. Writes are idempotent per day, so a
// care action cannot be logged twice for the same plant on the same day.
const { query } = require("../config/db");

const COLUMNS = "care_id, user_id, plant_id, action_type, note, care_date, xp_awarded, created_at";

const run = (client) => (client ? client.query.bind(client) : query);

/**
 * Records a care action. Must run inside withTransaction when it pays XP.
 * Returns null when this exact action was already logged today.
 */
async function create(client, { userId, plantId, actionType, note, careDate, xpAwarded }) {
  const { rows } = await client.query(
    `INSERT INTO care_actions (user_id, plant_id, action_type, note, care_date, xp_awarded)
     VALUES ($1, $2, $3, $4, COALESCE($5, (now() AT TIME ZONE 'UTC')::date), $6)
     ON CONFLICT (user_id, plant_id, action_type, care_date) DO NOTHING
     RETURNING ${COLUMNS}`,
    [userId, plantId, actionType, note || null, careDate || null, xpAwarded || 0]
  );
  return rows[0] || null;
}

/** Stamps the XP a care action earned, once the reward grant has paid it. */
async function setXpAwarded(client, careId, xp) {
  const { rows } = await client.query(
    `UPDATE care_actions SET xp_awarded = $2 WHERE care_id = $1 RETURNING ${COLUMNS}`,
    [careId, xp]
  );
  return rows[0] || null;
}

async function listForUser(userId, { limit = 50 } = {}, client) {
  const { rows } = await run(client)(
    `SELECT ${COLUMNS} FROM care_actions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function countForUser(userId, client) {
  const { rows } = await run(client)(
    "SELECT count(*)::int AS n FROM care_actions WHERE user_id = $1",
    [userId]
  );
  return rows[0].n;
}

async function distinctPlantsCared(userId, client) {
  const { rows } = await run(client)(
    "SELECT count(DISTINCT plant_id)::int AS n FROM care_actions WHERE user_id = $1",
    [userId]
  );
  return rows[0].n;
}

/** How many times one care action was logged, optionally inside a date window
 * (used by seasonal challenges). */
async function countByAction(userId, actionType, { from, to } = {}, client) {
  const { rows } = await run(client)(
    `SELECT count(*)::int AS n
       FROM care_actions
      WHERE user_id = $1 AND action_type = $2
        AND ($3::date IS NULL OR care_date >= $3)
        AND ($4::date IS NULL OR care_date <= $4)`,
    [userId, actionType, from || null, to || null]
  );
  return rows[0].n;
}

/** The distinct days a member logged care, most recent first — the raw input to
 * a streak calculation should it ever need rebuilding. */
async function careDates(userId, { limit = 60 } = {}, client) {
  const { rows } = await run(client)(
    `SELECT DISTINCT care_date FROM care_actions WHERE user_id = $1
      ORDER BY care_date DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map((row) => row.care_date);
}

module.exports = { create, setXpAwarded, listForUser, countForUser, distinctPlantsCared, countByAction, careDates };
