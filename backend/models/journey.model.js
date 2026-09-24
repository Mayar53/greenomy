// models/journey.model.js — a member's plant journey and its milestones.
// The only place journey SQL lives. Functions that must run inside a
// transaction take a `client`; reads use the shared pool.
const { query } = require("../config/db");

// Single line on purpose: listByUser() prefixes each column with "j.".
const JOURNEY_COLUMNS =
  "journey_id, user_plant_id, user_id, started_at, expected_duration_days, current_stage, status, completed_at, created_at, updated_at";
const MILESTONE_COLUMNS = `milestone_id, journey_id, stage_key, label_en, sort_order,
                           expected_day_from, expected_day_to, recommended_window, completed_at,
                           verification_status, verification_id`;

/** Must run inside withTransaction — the journey and its milestones land together. */
async function create(client, { userId, userPlantId, expectedDurationDays, currentStage }) {
  const { rows } = await client.query(
    `INSERT INTO journeys (user_id, user_plant_id, expected_duration_days, current_stage)
     VALUES ($1, $2, $3, $4)
     RETURNING ${JOURNEY_COLUMNS}`,
    [userId, userPlantId, expectedDurationDays ?? null, currentStage || "planting"]
  );
  return rows[0];
}

// Must run inside the same transaction as create().
async function addMilestones(client, journeyId, milestones) {
  const created = [];
  for (const milestone of milestones) {
    const { rows } = await client.query(
      `INSERT INTO journey_milestones
         (journey_id, stage_key, label_en, sort_order, expected_day_from, expected_day_to, recommended_window)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${MILESTONE_COLUMNS}`,
      [
        journeyId,
        milestone.stage_key,
        milestone.label_en,
        milestone.sort_order,
        milestone.expected_day_from ?? null,
        milestone.expected_day_to ?? null,
        milestone.recommended_window || null,
      ]
    );
    created.push(rows[0]);
  }
  return created;
}

async function findByPlant(userPlantId) {
  const { rows } = await query(
    `SELECT ${JOURNEY_COLUMNS} FROM journeys WHERE user_plant_id = $1`,
    [userPlantId]
  );
  return rows[0] || null;
}

async function findByIdForUser(journeyId, userId) {
  const { rows } = await query(
    `SELECT ${JOURNEY_COLUMNS} FROM journeys WHERE journey_id = $1 AND user_id = $2`,
    [journeyId, userId]
  );
  return rows[0] || null;
}

async function listByUser(userId) {
  const { rows } = await query(
    `SELECT j.${JOURNEY_COLUMNS.split(", ").join(", j.")}, p.plant_type
       FROM journeys j
       JOIN plants p ON p.plant_id = j.user_plant_id
      WHERE j.user_id = $1
      ORDER BY j.created_at DESC`,
    [userId]
  );
  return rows;
}

async function listMilestones(journeyId) {
  const { rows } = await query(
    `SELECT ${MILESTONE_COLUMNS} FROM journey_milestones WHERE journey_id = $1 ORDER BY sort_order`,
    [journeyId]
  );
  return rows;
}

async function findMilestone(journeyId, milestoneId) {
  const { rows } = await query(
    `SELECT ${MILESTONE_COLUMNS} FROM journey_milestones WHERE journey_id = $1 AND milestone_id = $2`,
    [journeyId, milestoneId]
  );
  return rows[0] || null;
}

/** Idempotent: only an uncompleted milestone can be completed, so a replayed
 * request changes nothing. */
async function completeMilestone(client, milestoneId, { verificationId, verificationStatus } = {}) {
  const { rows } = await client.query(
    `UPDATE journey_milestones
        SET completed_at = COALESCE(completed_at, now()),
            verification_id = COALESCE($2, verification_id),
            verification_status = COALESCE($3, verification_status)
      WHERE milestone_id = $1 AND completed_at IS NULL
      RETURNING ${MILESTONE_COLUMNS}`,
    [milestoneId, verificationId || null, verificationStatus || null]
  );
  return rows[0] || null;
}

async function setStage(client, journeyId, stageKey) {
  const { rows } = await client.query(
    `UPDATE journeys SET current_stage = $2, updated_at = now() WHERE journey_id = $1
     RETURNING ${JOURNEY_COLUMNS}`,
    [journeyId, stageKey]
  );
  return rows[0] || null;
}

async function complete(client, journeyId) {
  const { rows } = await client.query(
    `UPDATE journeys
        SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE journey_id = $1 AND status = 'active'
      RETURNING ${JOURNEY_COLUMNS}`,
    [journeyId]
  );
  return rows[0] || null;
}

module.exports = {
  create,
  addMilestones,
  findByPlant,
  findByIdForUser,
  listByUser,
  listMilestones,
  findMilestone,
  completeMilestone,
  setStage,
  complete,
};
