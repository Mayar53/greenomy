// models/reward.model.js
const crypto = require("crypto");
const { query } = require("../config/db");

const FIELD_MAP = {
  partner: "partner",
  category: "category",
  title: "title",
  description: "description",
  pointsRequired: "points_required",
  expiresAt: "expires_at",
  isActive: "is_active",
  i18n: "i18n",
};

const JSON_FIELDS = new Set(["i18n"]);

async function listActive() {
  const { rows } = await query(
    "SELECT * FROM rewards WHERE is_active = true ORDER BY points_required ASC"
  );
  return rows;
}

/** Admin list — includes deactivated rewards, newest first. */
async function listAll() {
  const { rows } = await query("SELECT * FROM rewards ORDER BY created_at DESC");
  return rows;
}

async function findById(rewardId) {
  const { rows } = await query("SELECT * FROM rewards WHERE reward_id = $1", [rewardId]);
  return rows[0] || null;
}

/** Row lock for the redemption transaction, so two concurrent redeems of the
 * same reward can't both pass the expiry/active checks. */
async function lockForUpdate(client, rewardId) {
  const { rows } = await client.query(
    "SELECT * FROM rewards WHERE reward_id = $1 FOR UPDATE",
    [rewardId]
  );
  return rows[0] || null;
}

/** reward_id is a text PK (the rw-001 ids from rewards.json), so admin-created
 * rewards get their own generated id rather than a uuid. */
async function create({ partner, category, title, description, pointsRequired, expiresAt, isActive, i18n }) {
  const rewardId = `rw_${crypto.randomUUID().slice(0, 8)}`;
  const { rows } = await query(
    `INSERT INTO rewards (reward_id, partner_id, partner, category, title, description,
                          points_required, expires_at, is_active, i18n)
     VALUES ($1, (SELECT partner_id FROM partners WHERE name = $2), $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      rewardId,
      partner,
      category,
      title,
      description || null,
      pointsRequired,
      expiresAt || null,
      isActive !== false,
      i18n ? JSON.stringify(i18n) : null,
    ]
  );
  return rows[0];
}

async function update(rewardId, changes) {
  const sets = [];
  const values = [rewardId];

  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (changes[key] === undefined) continue;
    const value = JSON_FIELDS.has(key) && changes[key] ? JSON.stringify(changes[key]) : changes[key];
    values.push(value);
    sets.push(`${column} = $${values.length}`);

    // Keep the denormalised partner_id in step when the display name changes.
    if (key === "partner") {
      values.push(changes[key]);
      sets.push(`partner_id = (SELECT partner_id FROM partners WHERE name = $${values.length})`);
    }
  }
  if (!sets.length) return findById(rewardId);

  sets.push("updated_at = now()");
  const { rows } = await query(
    `UPDATE rewards SET ${sets.join(", ")} WHERE reward_id = $1 RETURNING *`,
    values
  );
  return rows[0] || null;
}

module.exports = { listActive, listAll, findById, lockForUpdate, create, update };
