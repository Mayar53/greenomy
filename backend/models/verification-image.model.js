// models/verification-image.model.js — the hash record for every submitted
// photo. Duplicate detection reads this table across ALL users, so re-uploading
// someone else's image is caught, not just your own.
const { query } = require("../config/db");

const COLUMNS = `image_id, verification_id, user_id, sha256, phash, dhash, ahash,
                 width, height, bytes, mime, storage_path, created_at`;

/** Must run inside the verification transaction: the image record and the
 * verification it belongs to commit together. */
async function create(client, image) {
  const { rows } = await client.query(
    `INSERT INTO verification_images
       (verification_id, user_id, sha256, phash, dhash, ahash, width, height, bytes, mime, storage_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${COLUMNS}`,
    [
      image.verificationId || null,
      image.userId,
      image.sha256,
      image.phash || null,
      image.dhash || null,
      image.ahash || null,
      image.width || null,
      image.height || null,
      image.bytes || null,
      image.mime || null,
      image.storagePath || null,
    ]
  );
  return rows[0];
}

/** The image row is created first (it has no verification yet), then linked. */
async function linkVerification(client, imageId, verificationId) {
  const { rows } = await client.query(
    `UPDATE verification_images SET verification_id = $2 WHERE image_id = $1 RETURNING ${COLUMNS}`,
    [imageId, verificationId]
  );
  return rows[0] || null;
}

async function findBySha256(sha256) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM verification_images WHERE sha256 = $1`, [sha256]);
  return rows;
}

/** Hashes only, newest first — enough for the near-duplicate scan without
 * loading every image row's metadata. */
async function listHashes(limit = 2000) {
  const { rows } = await query(
    `SELECT image_id, verification_id, user_id, sha256, phash, dhash, ahash
       FROM verification_images
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function findByVerification(verificationId) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM verification_images WHERE verification_id = $1 LIMIT 1`,
    [verificationId]
  );
  return rows[0] || null;
}

module.exports = { create, linkVerification, findBySha256, listHashes, findByVerification };
