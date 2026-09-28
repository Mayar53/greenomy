// database/seed.js — idempotent reference data: admin account, partners,
// rewards, Green Hub articles and the plant catalog. Safe to re-run;
// everything upserts.
require("dotenv").config();
const path = require("path");
const bcrypt = require("bcrypt");
const { pool, withTransaction, assertConfigured } = require("../config/db");

const rewardsSeed = require(path.join(__dirname, "../../rewards.json"));
const greenHubSeed = require(path.join(__dirname, "../../greenhub.json"));
const plantSeed = require(path.join(__dirname, "../../plants.json"));
const plantNormalize = require("../services/plant-normalize.service");

// The owner account. Override with ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD.
const DEV_ADMIN_EMAIL = "mayarraws@gmail.com";
const DEV_ADMIN_PASSWORD = "admin12345";

/**
 * The owner account — the one account that can add other admins.
 *
 * Two cases, deliberately different:
 *   * no account for that email yet — create it with the seed password, so a
 *     fresh database has a way in;
 *   * the account already exists — PROMOTE it and leave the password alone.
 *     Re-seeding must never overwrite the owner's own password with a default.
 *
 * It is stored as super_admin with no permission rows: `super_admin` holds every
 * permission by definition (services/permissions.service.js), and it is the
 * account that can fix a bad grant — which is exactly why nothing may edit it.
 */
async function seedAdmin(client) {
  const isProd = process.env.NODE_ENV === "production";
  const email = (process.env.ADMIN_SEED_EMAIL || (isProd ? "" : DEV_ADMIN_EMAIL)).trim().toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD || (isProd ? null : DEV_ADMIN_PASSWORD);

  if (!email) {
    console.warn("No owner configured (ADMIN_SEED_EMAIL) — skipping the owner account.");
    return;
  }

  const { rows } = await client.query("SELECT user_id FROM users WHERE email = $1", [email]);

  if (rows[0]) {
    await client.query(
      `UPDATE users
          SET role        = 'super_admin',
              status      = 'active',
              permissions = '{}',
              updated_at  = now()
        WHERE user_id = $1`,
      [rows[0].user_id]
    );
    console.log(`owner     ${email} (super_admin — password left unchanged)`);
    return;
  }

  if (!password) {
    console.warn(`No account for ${email} and no ADMIN_SEED_PASSWORD — skipping the owner account.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    `INSERT INTO users (full_name, email, password_hash, role, status)
     VALUES ('Greenomy Owner', $1, $2, 'super_admin', 'active')`,
    [email, passwordHash]
  );
  console.log(`owner     ${email} (created as super_admin)`);
}

async function seedPartners(client) {
  const names = [...new Set(rewardsSeed.map((r) => r.partner))];
  for (const name of names) {
    await client.query(
      `INSERT INTO partners (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name]
    );
  }
  console.log(`partners  ${names.length}`);
}

async function seedRewards(client) {
  for (const reward of rewardsSeed) {
    await client.query(
      `INSERT INTO rewards (reward_id, partner_id, partner, category, title, description,
                            points_required, expires_at, is_active, i18n)
       VALUES ($1, (SELECT partner_id FROM partners WHERE name = $2), $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (reward_id) DO UPDATE
         SET partner_id      = EXCLUDED.partner_id,
             partner         = EXCLUDED.partner,
             category        = EXCLUDED.category,
             title           = EXCLUDED.title,
             description     = EXCLUDED.description,
             points_required = EXCLUDED.points_required,
             expires_at      = EXCLUDED.expires_at,
             is_active       = EXCLUDED.is_active,
             i18n            = EXCLUDED.i18n,
             updated_at      = now()`,
      [
        reward.id,
        reward.partner,
        reward.category,
        reward.title,
        reward.description,
        reward.pointsRequired,
        reward.expiresAt || null,
        reward.isActive !== false,
        reward.i18n ? JSON.stringify(reward.i18n) : null,
      ]
    );
  }
  console.log(`rewards   ${rewardsSeed.length}`);
}

async function seedGreenHub(client) {
  for (const article of greenHubSeed) {
    await client.query(
      `INSERT INTO green_hub_content (slug, title, description, category, content_type,
                                      body, image_url, reading_time, is_published, i18n)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (slug) DO UPDATE
         SET title        = EXCLUDED.title,
             description  = EXCLUDED.description,
             category     = EXCLUDED.category,
             content_type = EXCLUDED.content_type,
             body         = EXCLUDED.body,
             image_url    = EXCLUDED.image_url,
             reading_time = EXCLUDED.reading_time,
             is_published = EXCLUDED.is_published,
             i18n         = EXCLUDED.i18n,
             updated_at   = now()`,
      [
        article.slug,
        article.title,
        article.description,
        article.category,
        article.contentType || "article",
        JSON.stringify(article.body || []),
        article.imageUrl || null,
        article.readingTime || null,
        article.isPublished !== false,
        article.i18n ? JSON.stringify(article.i18n) : null,
      ]
    );
  }
  console.log(`green hub ${greenHubSeed.length}`);
}

/** Provenance for every structured fact. Seeded before the facts that cite it. */
async function seedKnowledgeSources(client) {
  for (const source of plantSeed.sources) {
    await client.query(
      `INSERT INTO knowledge_sources (source_id, name, url, organization, type, accessed_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_id) DO UPDATE
         SET name = EXCLUDED.name, url = EXCLUDED.url, organization = EXCLUDED.organization,
             type = EXCLUDED.type, accessed_at = EXCLUDED.accessed_at`,
      [source.id, source.name, source.url || null, source.organization || null, source.type || null, source.accessedAt || null]
    );
  }
  console.log(`sources   ${plantSeed.sources.length}`);
}

/**
 * Growth-stage templates. These are pure reference data with no dependants, so
 * they are replaced wholesale each run — editing a template in plants.json then
 * takes effect. Plant-specific overrides (plant_id set) are never touched.
 */
async function seedStageTemplates(client) {
  await client.query("DELETE FROM plant_growth_stages WHERE plant_id IS NULL");

  let count = 0;
  for (const [template, stages] of Object.entries(plantSeed.stageTemplates)) {
    for (let i = 0; i < stages.length; i += 1) {
      const stage = stages[i];
      await client.query(
        `INSERT INTO plant_growth_stages
           (plant_id, template, stage_key, label_en, label_ar, label_ku, sort_order, description)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)`,
        [template, stage.key, stage.label, stage.ar || null, stage.ku || null, i + 1, stage.description || null]
      );
      count += 1;
    }
  }
  console.log(`stages    ${count}`);
}

/** Structured facts derived from a plant's own columns, each carrying a source
 * and a confidence. Deriving them keeps one value in one place: the column is
 * the fact, plant_knowledge is its sourced, queryable form. */
function derivedKnowledge(plant) {
  const rows = [];
  const add = (type, value, unit, source, confidence) => {
    if (value === undefined || value === null) return;
    rows.push({ type, value, unit, source, confidence });
  };

  add("growth_duration_days", plant.growthDurationDays ?? plant.daysToHarvest, "days", "ecocrop", 0.7);
  add("germination_duration_days", plant.germinationDays, "days", "ecocrop", 0.7);
  if (plant.tempMin != null || plant.tempMax != null) {
    add("temperature_range", { min: plant.tempMin ?? null, max: plant.tempMax ?? null }, "celsius", "ecocrop", 0.6);
  }
  if (plant.soilPhMin != null || plant.soilPhMax != null) {
    add("soil_ph_range", { min: plant.soilPhMin ?? null, max: plant.soilPhMax ?? null }, "pH", "ecocrop", 0.6);
  }
  add("water_requirement", plant.water, null, "greenomy", 0.6);
  add("sunlight_requirement", plant.sun, null, "greenomy", 0.6);
  add("planting_season", plant.plantingSeason, null, "fao-calendar", 0.6);
  add("harvest_window", plant.harvestWindow, null, "fao-calendar", 0.6);
  add("soil_preferences", plant.soilPreferences, null, "greenomy", 0.5);
  return rows;
}

/** Every name a plant answers to, beyond the ones already stored as columns. */
function aliasRowsFor(plant) {
  const rows = [];
  const push = (language, alias, source) => {
    const value = String(alias || "").trim();
    if (!value) return;
    rows.push({ language, alias: value, normalized: plantNormalize.normalizeAlias(value), source });
  };

  push("en", plant.name, "greenomy");
  push("en", plant.slug && plant.slug.replace(/-/g, " "), "greenomy");
  push("en", plant.scientificName, "powo");
  if (plant.acceptedName && plant.acceptedName !== plant.scientificName) push("en", plant.acceptedName, "powo");
  if (plant.i18n && plant.i18n.ar) push("ar", plant.i18n.ar.name, "greenomy");
  if (plant.i18n && plant.i18n.ku) push("ku", plant.i18n.ku.name, "greenomy");
  // Kurdish regional/alternative names: one canonical display name, the rest are
  // search aliases, so a variant never becomes a second plant.
  for (const alternative of (plant.i18n && plant.i18n.ku && plant.i18n.ku.alternatives) || []) {
    push("ku", alternative, "greenomy");
  }
  for (const pair of plant.aliases || []) {
    if (Array.isArray(pair) && pair.length === 2) push(pair[0], pair[1], "greenomy");
  }
  return rows;
}

async function seedPlantCatalog(client) {
  for (const plant of plantSeed.plants) {
    await client.query(
      `INSERT INTO plant_catalog
         (id, name, slug, category, icon, days_to_harvest, difficulty, indoor, outdoor,
          sun, water, climates, planting_months, notes, i18n, scientific_name, accepted_name,
          family, description, growth_duration_days, germination_duration_days, temp_min_c,
          temp_max_c, soil_preferences, soil_ph_min, soil_ph_max, water_preferences,
          sunlight_preferences, planting_season, harvest_window, seed_available, stage_template, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
               $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, slug = EXCLUDED.slug, category = EXCLUDED.category,
             icon = EXCLUDED.icon, days_to_harvest = EXCLUDED.days_to_harvest,
             difficulty = EXCLUDED.difficulty, indoor = EXCLUDED.indoor, outdoor = EXCLUDED.outdoor,
             sun = EXCLUDED.sun, water = EXCLUDED.water, climates = EXCLUDED.climates,
             planting_months = EXCLUDED.planting_months, notes = EXCLUDED.notes, i18n = EXCLUDED.i18n,
             scientific_name = EXCLUDED.scientific_name, accepted_name = EXCLUDED.accepted_name,
             family = EXCLUDED.family, description = EXCLUDED.description,
             growth_duration_days = EXCLUDED.growth_duration_days,
             germination_duration_days = EXCLUDED.germination_duration_days,
             temp_min_c = EXCLUDED.temp_min_c, temp_max_c = EXCLUDED.temp_max_c,
             soil_preferences = EXCLUDED.soil_preferences, soil_ph_min = EXCLUDED.soil_ph_min,
             soil_ph_max = EXCLUDED.soil_ph_max, water_preferences = EXCLUDED.water_preferences,
             sunlight_preferences = EXCLUDED.sunlight_preferences,
             planting_season = EXCLUDED.planting_season, harvest_window = EXCLUDED.harvest_window,
             seed_available = EXCLUDED.seed_available, stage_template = EXCLUDED.stage_template,
             is_active = EXCLUDED.is_active, updated_at = now()`,
      [
        plant.id,
        plant.name,
        plant.slug,
        plant.category,
        plant.icon || null,
        plant.daysToHarvest,
        plant.difficulty,
        plant.indoor === true,
        plant.outdoor === true,
        plant.sun,
        plant.water,
        plant.climates || [],
        plant.plantingMonths || [],
        plant.notes || null,
        plant.i18n ? JSON.stringify(plant.i18n) : null,
        plant.scientificName || null,
        plant.acceptedName || plant.scientificName || null,
        plant.family || null,
        plant.description || null,
        plant.growthDurationDays ?? plant.daysToHarvest ?? null,
        plant.germinationDays ?? null,
        plant.tempMin ?? null,
        plant.tempMax ?? null,
        plant.soilPreferences || null,
        plant.soilPhMin ?? null,
        plant.soilPhMax ?? null,
        plant.water || null,
        plant.sun || null,
        plant.plantingSeason || null,
        plant.harvestWindow || null,
        plant.seedAvailable !== false,
        plant.stageTemplate || null,
        plant.isActive !== false,
      ]
    );
  }
  console.log(`catalog   ${plantSeed.plants.length}`);
}

async function seedPlantAliases(client) {
  // One alias must resolve to one plant. The first plant in file order keeps it;
  // a later claim is reported rather than silently reassigning the name.
  const owners = new Map();
  let count = 0;

  for (const plant of plantSeed.plants) {
    for (const row of aliasRowsFor(plant)) {
      if (!row.normalized) continue;
      const key = `${row.language}:${row.normalized}`;
      const existing = owners.get(key);
      if (existing && existing !== plant.id) {
        console.warn(`alias clash: "${row.alias}" (${row.language}) kept by ${existing}, skipped for ${plant.id}`);
        continue;
      }
      owners.set(key, plant.id);

      await client.query(
        `INSERT INTO plant_aliases (plant_id, language, alias, normalized_alias, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (normalized_alias, language) DO UPDATE
           SET plant_id = EXCLUDED.plant_id, alias = EXCLUDED.alias, source = EXCLUDED.source`,
        [plant.id, row.language, row.alias, row.normalized, row.source]
      );
      count += 1;
    }
  }
  console.log(`aliases   ${count}`);
}

async function seedCatalogVarieties(client) {
  let count = 0;
  for (const plant of plantSeed.plants) {
    for (const variety of plant.varieties || []) {
      await client.query(
        `INSERT INTO plant_varieties
           (plant_id, name, description, growth_duration_days, special_requirements, i18n)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (plant_id, name) DO UPDATE
           SET description = EXCLUDED.description,
               growth_duration_days = EXCLUDED.growth_duration_days,
               special_requirements = EXCLUDED.special_requirements,
               i18n = EXCLUDED.i18n, updated_at = now()`,
        [
          plant.id,
          variety.name,
          variety.description || null,
          variety.growthDurationDays || null,
          variety.specialRequirements || null,
          JSON.stringify(variety.i18n || {}),
        ]
      );
      count += 1;
    }
  }
  console.log(`varieties  ${count}`);
}

async function seedCatalogKnowledge(client) {
  let count = 0;
  for (const plant of plantSeed.plants) {
    for (const fact of derivedKnowledge(plant)) {
      await client.query(
        `INSERT INTO plant_knowledge (plant_id, knowledge_type, value, unit, source_id, confidence)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6)
         ON CONFLICT (plant_id, knowledge_type, source_id) DO UPDATE
           SET value = EXCLUDED.value, unit = EXCLUDED.unit,
               confidence = EXCLUDED.confidence, updated_at = now()`,
        [plant.id, fact.type, JSON.stringify(fact.value), fact.unit, fact.source, fact.confidence]
      );
      count += 1;
    }
  }
  console.log(`knowledge ${count}`);
}

/**
 * Links members' EXISTING plants to the canonical catalog where the name can be
 * resolved. Idempotent (only rows with no link yet are considered) and strictly
 * non-destructive: an unresolvable name is left exactly as it is.
 */
async function normalizeExistingPlants(client) {
  const { rows } = await client.query(
    "SELECT plant_id, plant_type FROM plants WHERE canonical_plant_id IS NULL"
  );
  if (!rows.length) return;

  const { rows: aliases } = await client.query("SELECT alias, normalized_alias, plant_id FROM plant_aliases");
  const byNormalized = new Map();
  const byTerm = new Map();
  for (const alias of aliases) byNormalized.set(alias.normalized_alias, alias.plant_id);

  const { rows: catalog } = await client.query("SELECT id, name, slug FROM plant_catalog");
  for (const entry of catalog) {
    for (const name of [entry.name, entry.slug.replace(/-/g, " ")]) {
      byNormalized.set(plantNormalize.normalizeAlias(name), entry.id);
      for (const term of plantNormalize.terms(name)) {
        if (!byTerm.has(term)) byTerm.set(term, entry.id);
      }
    }
  }
  for (const alias of aliases) {
    for (const term of plantNormalize.terms(alias.alias)) {
      if (!byTerm.has(term)) byTerm.set(term, alias.plant_id);
    }
  }

  let matched = 0;
  for (const plant of rows) {
    const name = plant.plant_type || "";
    let canonicalId = byNormalized.get(plantNormalize.normalizeAlias(name));
    if (!canonicalId) {
      for (const term of plantNormalize.terms(name)) {
        if (byTerm.has(term)) {
          canonicalId = byTerm.get(term);
          break;
        }
      }
    }
    if (!canonicalId) continue;

    await client.query("UPDATE plants SET canonical_plant_id = $2 WHERE plant_id = $1", [
      plant.plant_id,
      canonicalId,
    ]);
    matched += 1;
  }

  console.log(`linked    ${matched}/${rows.length} existing plants to the catalog`);
}

async function main() {
  assertConfigured();

  await withTransaction(async (client) => {
    await seedAdmin(client);
    await seedPartners(client);
    await seedRewards(client);
    await seedGreenHub(client);
    // Order matters: sources and stages first, then the catalog they belong to,
    // then the aliases/knowledge that reference it, then the backfill that reads
    // the aliases.
    await seedKnowledgeSources(client);
    await seedStageTemplates(client);
    await seedPlantCatalog(client);
    await seedPlantAliases(client);
    await seedCatalogVarieties(client);
    await seedCatalogKnowledge(client);
    await normalizeExistingPlants(client);
  });
  console.log("\nSeed complete.");
}

// Guarded so requiring this module (e.g. from a test) does not run the seed.
if (require.main === module) {
  main()
    .then(() => pool.end())
    .catch((err) => {
      console.error(`\nSeed failed: ${err.message}`);
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = { normalizeExistingPlants };
