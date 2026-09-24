// models/plant-alias.model.js — every alternate name a catalog plant answers
// to, in every supported language. Read-only here; the seeder writes them from
// plants.json (matching how the other reference tables are seeded).
const { query } = require("../config/db");

const COLUMNS = "alias_id, plant_id, language, alias, normalized_alias, source";

async function listAll() {
  const { rows } = await query(`SELECT ${COLUMNS} FROM plant_aliases ORDER BY plant_id, language`);
  return rows;
}

async function listByPlant(plantId) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM plant_aliases WHERE plant_id = $1 ORDER BY language`,
    [plantId]
  );
  return rows;
}

/** One query for a set of plants, so search does not issue a query per row. */
async function listByPlants(plantIds) {
  if (!plantIds || !plantIds.length) return [];
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM plant_aliases WHERE plant_id = ANY($1::text[]) ORDER BY plant_id, language`,
    [plantIds]
  );
  return rows;
}

/** Exact alias lookup — how a typed name is folded to one canonical plant. */
async function findByNormalized(normalizedAlias, language) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM plant_aliases
      WHERE normalized_alias = $1 ${language ? "AND language = $2" : ""}
      ORDER BY language
      LIMIT 1`,
    language ? [normalizedAlias, language] : [normalizedAlias]
  );
  return rows[0] || null;
}

module.exports = { listAll, listByPlant, listByPlants, findByNormalized };
