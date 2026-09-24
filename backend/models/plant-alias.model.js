// models/plant-alias.model.js — every alternate name a catalog plant answers
// to, in every supported language. Read-only here; the seeder writes them from
// plants.json (matching how the other reference tables are seeded).
const { query } = require("../config/db");

const COLUMNS = "alias_id, plant_id, language, alias, normalized_alias, source";

/** One query for a set of plants, so search does not issue a query per row. */
async function listByPlants(plantIds) {
  if (!plantIds || !plantIds.length) return [];
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM plant_aliases WHERE plant_id = ANY($1::text[]) ORDER BY plant_id, language`,
    [plantIds]
  );
  return rows;
}

module.exports = { listByPlants };
