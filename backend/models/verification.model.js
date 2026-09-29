// models/verification.model.js
const { query } = require("../config/db");

/** Must run inside withTransaction — the caller also awards points. */
async function create(client, v) {
  const { rows } = await client.query(
    `INSERT INTO verifications
       (plant_id, user_id, image_url, gps_lat, gps_long, captured_at,
        ai_confidence_score, ai_provider, ai_metrics, approval_status,
        image_sha256, storage_path, challenge_id, milestone_id,
        duplicate_status, continuity_distance, continuity_status,
        requires_review, verification_result)
     VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
      v.imageSha256 || null,
      v.storagePath || null,
      v.challengeId || null,
      v.milestoneId || null,
      v.duplicateStatus || "none",
      v.continuityDistance ?? null,
      v.continuityStatus || null,
      v.requiresReview === true,
      v.verificationResult ? JSON.stringify(v.verificationResult) : null,
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

/**
 * A member's submissions for the admin user panel, newest first, with the
 * plant's type. Deliberately a narrow column list: it carries the bounded
 * preview (`image_url`) the review queue already shows admins, but NOT the
 * member's GPS coordinates or image hashes, which this screen has no use for.
 * Reading the ORIGINAL stays owner-only (GET /verifications/:id/image).
 */
async function listByUserWithPlant(userId, { limit = 12 } = {}) {
  const { rows } = await query(
    `SELECT v.verification_id, v.created_at, v.approval_status, v.requires_review,
            v.ai_confidence_score, v.image_url, v.milestone_id, p.plant_type
       FROM verifications v
       LEFT JOIN plants p ON p.plant_id = v.plant_id
      WHERE v.user_id = $1
      ORDER BY v.created_at DESC
      LIMIT $2`,
    [userId, limit]
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

/** How many photos this member has already submitted for a plant — the
 * "have we seen this plant before" signal for journey consistency. */
/** The hashes of this member's EARLIER photos of this plant — what the
 * continuity check compares a new frame against. Never another member's. */
async function hashesForPlant(userId, plantId, { limit = 40, excludeVerificationId = null } = {}) {
  const { rows } = await query(
    `SELECT i.phash, i.dhash, i.ahash, v.milestone_id, v.created_at
       FROM verifications v
       JOIN verification_images i ON i.verification_id = v.verification_id
      WHERE v.user_id = $1 AND v.plant_id = $2
        AND ($3::uuid IS NULL OR v.verification_id <> $3::uuid)
      ORDER BY v.created_at DESC
      LIMIT $4`,
    [userId, plantId, excludeVerificationId, limit]
  );
  return rows;
}

async function countForPlant(userId, plantId) {
  const { rows } = await query(
    "SELECT count(*)::int AS n FROM verifications WHERE user_id = $1 AND plant_id = $2",
    [userId, plantId]
  );
  return rows[0].n;
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
  listByUserWithPlant,
  findById,
  listPending,
  approve,
  reject,
  hashesForPlant,
  countForPlant,
  countApprovedByUser,
};
