// models/plant.model.js
const { query } = require("../config/db");

// The API speaks camelCase for plant updates; the columns are snake_case.
const FIELD_MAP = {
  plantType: "plant_type",
  plantingMethod: "planting_method",
  stage: "stage",
  plantingDate: "planting_date",
  location: "location",
  lastWatered: "last_watered",
  nextWatering: "next_watering",
  status: "status",
};

async function listByUser(userId) {
  const { rows } = await query(
    "SELECT * FROM plants WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows;
}

async function create({
  userId,
  plantType,
  plantingMethod,
  plantingDate,
  location,
  canonicalPlantId,
  varietyId,
  customName,
}) {
  const { rows } = await query(
    `INSERT INTO plants (user_id, plant_type, planting_method, planting_date, location,
                         canonical_plant_id, variety_id, custom_name)
     VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6, $7, $8)
     RETURNING *`,
    [
      userId,
      plantType,
      plantingMethod || null,
      plantingDate || null,
      location || null,
      canonicalPlantId || null,
      varietyId || null,
      customName || null,
    ]
  );
  return rows[0];
}

async function findByIdForUser(plantId, userId) {
  const { rows } = await query(
    "SELECT * FROM plants WHERE plant_id = $1 AND user_id = $2",
    [plantId, userId]
  );
  return rows[0] || null;
}

/** Returns null when there is nothing to change or the plant isn't theirs. */
async function update(plantId, userId, changes) {
  const sets = [];
  const values = [plantId, userId];

  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (changes[key] !== undefined) {
      values.push(changes[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (!sets.length) return findByIdForUser(plantId, userId);

  sets.push("updated_at = now()");
  const { rows } = await query(
    `UPDATE plants SET ${sets.join(", ")}
      WHERE plant_id = $1 AND user_id = $2
      RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function remove(plantId, userId) {
  const { rowCount } = await query(
    "DELETE FROM plants WHERE plant_id = $1 AND user_id = $2",
    [plantId, userId]
  );
  return rowCount > 0;
}

/** Records a watering: when it happened and when the next one is due. Must run
 * inside withTransaction when it accompanies a care action. */
async function setWatering(client, plantId, { lastWatered, nextWatering }) {
  const { rows } = await client.query(
    `UPDATE plants
        SET last_watered = $2, next_watering = $3, updated_at = now()
      WHERE plant_id = $1
      RETURNING *`,
    [plantId, lastWatered || null, nextWatering || null]
  );
  return rows[0] || null;
}

/** Plants whose next watering is due, with the owner's contact details — the
 * input to the reminder job. Only active plants with a schedule are included. */
async function listDueForWatering() {
  const { rows } = await query(
    `SELECT p.plant_id, p.user_id, p.plant_type, p.custom_name, p.location, p.next_watering,
            u.email, u.full_name
       FROM plants p
       JOIN users u ON u.user_id = p.user_id
      WHERE p.status = 'active'
        AND p.next_watering IS NOT NULL
        AND p.next_watering <= now()
      ORDER BY p.user_id, p.next_watering`
  );
  return rows;
}

/** Homepage impact: every plant counts as a started seed. */
async function countAll() {
  const { rows } = await query("SELECT count(*)::int AS n FROM plants");
  return rows[0].n;
}

async function countByUser(userId) {
  const { rows } = await query(
    "SELECT count(*)::int AS n FROM plants WHERE user_id = $1",
    [userId]
  );
  return rows[0].n;
}

/** Homepage impact: a plant is "grown" once a photo of it is approved. */
async function countGrown() {
  const { rows } = await query(
    `SELECT count(*)::int AS n
       FROM plants p
      WHERE EXISTS (
        SELECT 1 FROM verifications v
         WHERE v.plant_id = p.plant_id AND v.approval_status = 'approved'
      )`
  );
  return rows[0].n;
}

module.exports = {
  listByUser,
  create,
  findByIdForUser,
  update,
  remove,
  setWatering,
  listDueForWatering,
  countAll,
  countByUser,
  countGrown,
};
