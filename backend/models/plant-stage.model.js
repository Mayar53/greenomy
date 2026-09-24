// models/plant-stage.model.js — the growth stages a plant walks through.
//
// A plant-specific row (plant_id set) wins; otherwise the plant's template rows
// (plant_id NULL) apply. That is what lets one plant carry a bespoke schedule
// while every other plant of the same kind reuses a shared, configurable one —
// no schedule is hardcoded for a single crop.
const { query } = require("../config/db");

const COLUMNS = `stage_id, plant_id, template, stage_key, label_en, label_ar, label_ku,
                 sort_order, expected_day_from, expected_day_to, description`;

async function listForPlant(plantId, template) {
  if (plantId) {
    const { rows } = await query(
      `SELECT ${COLUMNS} FROM plant_growth_stages WHERE plant_id = $1 ORDER BY sort_order`,
      [plantId]
    );
    if (rows.length) return rows;
  }

  if (template) {
    const { rows } = await query(
      `SELECT ${COLUMNS} FROM plant_growth_stages
        WHERE plant_id IS NULL AND template = $1 ORDER BY sort_order`,
      [template]
    );
    if (rows.length) return rows;
  }

  return [];
}

async function listTemplates() {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM plant_growth_stages WHERE plant_id IS NULL ORDER BY template, sort_order`
  );
  return rows;
}

module.exports = { listForPlant, listTemplates };
