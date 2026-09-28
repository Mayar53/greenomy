// services/plant-name.service.js — the display name of a member's plant.
//
// IDENTITY vs DISPLAY. A member's plant stores `plant_type` (the English name,
// kept for backward compatibility) and, for catalog plants, `canonical_plant_id`
// — the permanent identity. The name a human reads is resolved from the catalog
// in the reader's language, so the same plant shows as Tomato / طماطم / تەماتە
// without a second plant row per language, and a corrected catalog name shows up
// everywhere at once.
//
// The rule this file exists to enforce:
//   plant id = identity · scientific name = biological reference
//   catalog names = display · alternative names = search aliases
const catalogModel = require("../models/plant-catalog.model");

const SUPPORTED = ["en", "ar", "ku"];
const DEFAULT_LANGUAGE = "en";

/** The language a request wants: an explicit `?lang=`, else the first supported
 * language in Accept-Language, else English. The web client sends the reader's
 * chosen language on every call. */
function requestLanguage(req) {
  const explicit = String((req && req.query && req.query.lang) || "").trim().toLowerCase();
  if (SUPPORTED.includes(explicit)) return explicit;

  const header = String((req && req.get && req.get("accept-language")) || "").toLowerCase();
  for (const part of header.split(",")) {
    const tag = part.split(";")[0].trim().split("-")[0];
    if (SUPPORTED.includes(tag)) return tag;
  }
  return DEFAULT_LANGUAGE;
}

/** Every catalog plant's name per language, for the ids asked about. One query
 * per request, not one per row. */
async function namesByIds(ids) {
  const wanted = [...new Set((ids || []).filter(Boolean))];
  const names = new Map();
  if (!wanted.length) return names;

  const plants = await catalogModel.listActive();
  for (const plant of plants) {
    if (!wanted.includes(plant.id)) continue;
    const perLanguage = { en: plant.name };
    for (const [lang, locale] of Object.entries(plant.i18n || {})) {
      if (locale && locale.name) perLanguage[lang] = locale.name;
    }
    names.set(plant.id, perLanguage);
  }
  return names;
}

/** What to show for one plant. A member's own name for a plant they typed in
 * always wins; otherwise the catalog name in the reader's language; otherwise
 * the stored English name, so nothing ever renders blank. */
function displayName(plant, names, lang) {
  if (!plant) return "";
  if (plant.custom_name) return plant.custom_name;
  const perLanguage = names.get(plant.canonical_plant_id);
  return (perLanguage && perLanguage[lang]) || plant.plant_type || "";
}

/** Adds `plant_name` to each row that stands for a plant. `plant_type` is left
 * exactly as it was, so older clients keep working. */
async function decorate(rows, lang) {
  const list = Array.isArray(rows) ? rows : [rows];
  const present = list.filter(Boolean);
  if (!present.length) return rows;

  const names = await namesByIds(present.map((row) => row.canonical_plant_id));
  for (const row of present) {
    if (row && "canonical_plant_id" in row) row.plant_name = displayName(row, names, lang);
  }
  return rows;
}

module.exports = { requestLanguage, namesByIds, displayName, decorate, SUPPORTED };
