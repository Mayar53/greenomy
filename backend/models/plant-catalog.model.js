// models/plant-catalog.model.js — the reference catalog of growable plants.
// The single place plant_catalog SQL lives. Rows come back snake_case and the
// client normalizes, matching the other models.
const { query } = require("../config/db");

const CATALOG_COLUMNS = `id, name, slug, category, emoji, days_to_harvest, difficulty,
                         indoor, outdoor, sun, water, climates, planting_months,
                         notes, i18n, is_active, created_at, updated_at`;

/** Everything a member could be recommended, alphabetically within category. */
async function listActive() {
  const { rows } = await query(
    `SELECT ${CATALOG_COLUMNS}
       FROM plant_catalog
      WHERE is_active = true
      ORDER BY category, name`
  );
  return rows;
}

async function findById(id) {
  const { rows } = await query(
    `SELECT ${CATALOG_COLUMNS} FROM plant_catalog WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function countAll() {
  const { rows } = await query(`SELECT count(*)::int AS count FROM plant_catalog`);
  return rows[0].count;
}

module.exports = { listActive, findById, countAll };
