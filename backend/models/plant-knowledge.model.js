// models/plant-knowledge.model.js — structured, sourced facts about a plant,
// its varieties, and the provenance of each fact.
//
// This is the database-of-truth the assistant is told to read exact values
// from. It reads only; the seeder populates it from plants.json.
const { query } = require("../config/db");

const KNOWLEDGE_COLUMNS = `k.knowledge_id, k.plant_id, k.knowledge_type, k.value, k.unit,
                           k.source_id, k.confidence, k.updated_at,
                           s.name AS source_name, s.url AS source_url,
                           s.organization AS source_organization, s.type AS source_type`;

async function listByPlant(plantId) {
  const { rows } = await query(
    `SELECT ${KNOWLEDGE_COLUMNS}
       FROM plant_knowledge k
       LEFT JOIN knowledge_sources s ON s.source_id = k.source_id
      WHERE k.plant_id = $1
      ORDER BY k.knowledge_type`,
    [plantId]
  );
  return rows;
}

async function listByPlants(plantIds) {
  if (!plantIds || !plantIds.length) return [];
  const { rows } = await query(
    `SELECT ${KNOWLEDGE_COLUMNS}
       FROM plant_knowledge k
       LEFT JOIN knowledge_sources s ON s.source_id = k.source_id
      WHERE k.plant_id = ANY($1::text[])
      ORDER BY k.plant_id, k.knowledge_type`,
    [plantIds]
  );
  return rows;
}

async function listSources() {
  const { rows } = await query(
    `SELECT source_id, name, url, organization, type, accessed_at FROM knowledge_sources ORDER BY source_id`
  );
  return rows;
}

async function listVarieties(plantId) {
  const { rows } = await query(
    `SELECT variety_id, plant_id, name, description, growth_duration_days,
            special_requirements, i18n
       FROM plant_varieties
      WHERE plant_id = $1
      ORDER BY name`,
    [plantId]
  );
  return rows;
}

module.exports = { listByPlant, listByPlants, listSources, listVarieties };
