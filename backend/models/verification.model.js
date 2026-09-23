// models/verification.model.js
const { query } = require("../config/db");

/** Must run inside withTransaction — the caller also awards points. */
async function create(client, v) {
  const { rows } = await client.query(
    `INSERT INTO verifications
       (plant_id, user_id, image_url, gps_lat, gps_long, captured_at,
        ai_confidence_score, ai_provider, ai_metrics, approval_status)
     VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9)
     RETURNING *`,
    [
      v.plantId,
      v.userId,
      v.imageUrl,
      v.gpsLat ?? null,
      v.gpsLong ?? null,
      v.confidence,
      v.provider || null,
      v.metrics ? JSON.stringify(v.metrics) : null,
      v.approvalStatus,
    ]
  );
  return rows[0];
}

async function findByIdForUser(verificationId, userId) {
  const { rows } = await query(
    "SELECT * FROM verifications WHERE verification_id = $1 AND user_id = $2",
    [verificationId, userId]
  );
  return rows[0] || null;
}

async function listByUser(userId) {
  const { rows } = await query(
    "SELECT * FROM verifications WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows;
}

async function findById(verificationId) {
  const { rows } = await query(
    "SELECT * FROM verifications WHERE verification_id = $1",
    [verificationId]
  );
  return rows[0] || null;
}

/** Admin queue, with the plant's type joined in for context. */
async function listPending() {
  const { rows } = await query(
    `SELECT v.*, p.plant_type
       FROM verifications v
       LEFT JOIN plants p ON p.plant_id = v.plant_id
      WHERE v.approval_status = 'pending'
      ORDER BY v.created_at ASC`
  );
  return rows;
}

/** Only a still-pending record can be approved, so points can't be paid twice. */
async function approve(client, verificationId, adminId) {
  const { rows } = await client.query(
    `UPDATE verifications
        SET approval_status  = 'approved',
            admin_reviewed_by = $2,
            reviewed_at       = now()
      WHERE verification_id = $1 AND approval_status = 'pending'
      RETURNING *`,
    [verificationId, adminId]
  );
  return rows[0] || null;
}

async function reject(client, verificationId, adminId, reason) {
  const { rows } = await client.query(
    `UPDATE verifications
        SET approval_status  = 'rejected',
            admin_reviewed_by = $2,
            rejection_reason  = $3,
            reviewed_at       = now()
      WHERE verification_id = $1 AND approval_status = 'pending'
      RETURNING *`,
    [verificationId, adminId, reason || null]
  );
  return rows[0] || null;
}

async function countApprovedByUser(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n
       FROM verifications
      WHERE user_id = $1 AND approval_status = 'approved'`,
    [userId]
  );
  return rows[0].n;
}

module.exports = {
  create,
  findByIdForUser,
  listByUser,
  findById,
  listPending,
  approve,
  reject,
  countApprovedByUser,
};
