// models/plant-catalog.model.js — the canonical catalog of growable plants.
// The single place plant_catalog SQL lives. Rows come back snake_case and the
// client normalizes, matching the other models.
//
// Identity: one row per plant. Every other name (English plural, scientific
// name, MSA/Iraqi/Kurdish colloquial) is a row in plant_aliases pointing here,
// so search resolves them to the same plant instead of creating duplicates.
const { query } = require("../config/db");
const aliasModel = require("./plant-alias.model");
const plantNormalize = require("../services/plant-normalize.service");

const CATALOG_COLUMNS = `id, name, slug, category, icon, days_to_harvest, difficulty,
                         indoor, outdoor, sun, water, climates, planting_months,
                         notes, i18n, scientific_name, accepted_name, family, description,
                         growth_duration_days, germination_duration_days, temp_min_c, temp_max_c,
                         soil_preferences, soil_ph_min, soil_ph_max, water_preferences,
                         sunlight_preferences, planting_season, harvest_window, seed_available,
                         stage_template, is_active, created_at, updated_at`;

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

async function findBySlug(slug) {
  const { rows } = await query(
    `SELECT ${CATALOG_COLUMNS} FROM plant_catalog WHERE slug = $1`,
    [slug]
  );
  return rows[0] || null;
}

async function countAll() {
  const { rows } = await query(`SELECT count(*)::int AS count FROM plant_catalog`);
  return rows[0].count;
}

/** Every localized name an entry answers to, as one searchable string. */
function nameText(plant) {
  const parts = [plant.name, plant.slug, plant.scientific_name, plant.accepted_name];
  for (const locale of Object.values(plant.i18n || {})) {
    if (locale && locale.name) parts.push(locale.name);
  }
  return parts.filter(Boolean).join(" ");
}

/**
 * Alias- and synonym-aware search across every language we support.
 *
 * The catalog is small (a few hundred rows), so this loads the active set once
 * and folds in memory with the SAME normalizer the assistant uses — which is
 * what keeps a search box and a chat question resolving a name identically.
 * Ranked, never fuzzy-matched into a wrong plant: a query that matches nothing
 * returns nothing rather than a best-effort guess.
 */
async function search({ q, lang, category, limit = 20 } = {}) {
  let catalog = await listActive();
  if (category && category !== "all") {
    catalog = catalog.filter((plant) => plant.category === category);
  }

  const query_text = String(q || "").trim();
  if (!query_text) {
    return catalog.slice(0, limit);
  }

  const normalizedQuery = plantNormalize.normalizeAlias(query_text);
  const queryTerms = plantNormalize.terms(query_text);

  const aliases = await aliasModel.listByPlants(catalog.map((plant) => plant.id));
  const aliasesByPlant = new Map();
  for (const alias of aliases) {
    const list = aliasesByPlant.get(alias.plant_id) || [];
    list.push(alias);
    aliasesByPlant.set(alias.plant_id, list);
  }

  const scored = [];
  for (const plant of catalog) {
    const ownAliases = aliasesByPlant.get(plant.id) || [];
    let score = 0;

    for (const alias of ownAliases) {
      if (alias.normalized_alias === normalizedQuery) score += 1000;
      else if (normalizedQuery.length >= 3 && alias.normalized_alias.startsWith(normalizedQuery)) score += 200;
      else if (normalizedQuery.length >= 4 && alias.normalized_alias.includes(normalizedQuery)) score += 80;
    }

    const names = plantNormalize.normalizeAlias(nameText(plant));
    if (names === normalizedQuery) score += 500;
    else if (names.includes(normalizedQuery)) score += 250;

    for (const term of queryTerms) {
      if (plantNormalize.terms(nameText(plant)).has(term)) score += 20;
      for (const alias of ownAliases) {
        if (plantNormalize.terms(alias.alias).has(term)) score += 10;
      }
    }

    // A language hint only breaks ties; it never hides a plant.
    if (lang && plant.i18n && plant.i18n[lang]) score += 1;

    if (score > 0) scored.push({ plant, score });
  }

  scored.sort((a, b) => b.score - a.score || String(a.plant.name).localeCompare(String(b.plant.name)));
  return scored.slice(0, limit).map((entry) => ({ ...entry.plant, match_score: entry.score }));
}

module.exports = { listActive, findById, findBySlug, countAll, search, CATALOG_COLUMNS };
