// models/journey.model.js — a member's plant journey and its milestones.
// The only place journey SQL lives. Functions that must run inside a
// transaction take a `client`; reads use the shared pool.
const { query } = require("../config/db");

// Single line on purpose: listByUser() prefixes each column with "j.".
const JOURNEY_COLUMNS =
  "journey_id, user_plant_id, user_id, started_at, expected_duration_days, current_stage, status, completed_at, created_at, updated_at";
// Single line on purpose: milestoneForUser() prefixes each column with "m.".
const MILESTONE_COLUMNS =
  "milestone_id, journey_id, stage_key, label_en, sort_order, expected_day_from, expected_day_to, recommended_window, completed_at, verification_status, verification_id";

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
    `SELECT j.${JOURNEY_COLUMNS.split(", ").join(", j.")},
            p.plant_id, p.plant_type, p.canonical_plant_id, p.planting_method, p.planting_date,
            c.stage_template, c.icon AS plant_icon
       FROM journeys j
       JOIN plants p ON p.plant_id = j.user_plant_id
       LEFT JOIN plant_catalog c ON c.id = p.canonical_plant_id
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

/** A milestone plus its journey, scoped to the owner — so a photo can be tied
 * to a milestone without the client naming the journey. */
async function milestoneForUser(milestoneId, userId) {
  const { rows } = await query(
    `SELECT m.${MILESTONE_COLUMNS.split(", ").join(", m.")}, j.journey_id, j.user_id, j.status AS journey_status
       FROM journey_milestones m
       JOIN journeys j ON j.journey_id = m.journey_id
      WHERE m.milestone_id = $1 AND j.user_id = $2`,
    [milestoneId, userId]
  );
  return rows[0] || null;
}

/** Must run inside withTransaction. */
async function setMilestoneVerification(client, milestoneId, { verificationId, verificationStatus }) {
  const { rows } = await client.query(
    `UPDATE journey_milestones
        SET verification_id = COALESCE($2, verification_id),
            verification_status = COALESCE($3, verification_status)
      WHERE milestone_id = $1
      RETURNING ${MILESTONE_COLUMNS}`,
    [milestoneId, verificationId || null, verificationStatus || null]
  );
  return rows[0] || null;
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
  milestoneForUser,
  setMilestoneVerification,
  completeMilestone,
  setStage,
  complete,
};
