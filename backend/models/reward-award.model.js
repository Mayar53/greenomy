// models/reward-award.model.js — the idempotency ledger for points.
const { query } = require("../config/db");

const COLUMNS = "award_id, user_id, journey_id, milestone_id, award_type, points, reference_id, created_at";

/**
 * Records an award. Must run inside withTransaction with the balance update.
 *
 * ON CONFLICT DO NOTHING is the whole point: a replayed approval or a
 * resubmitted milestone photo returns no row, and the caller then awards
 * nothing. Returns null when this award already exists.
 */
async function create(client, award) {
  const { rows } = await client.query(
    `INSERT INTO reward_awards (user_id, journey_id, milestone_id, award_type, points, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, award_type, reference_id) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      award.userId,
      award.journeyId || null,
      award.milestoneId || null,
      award.awardType,
      award.points,
      award.referenceId,
    ]
  );
  return rows[0] || null;
}

module.exports = { create };
