-- 005_plant_catalog_v2.sql — canonical plant identity, aliases, varieties,
-- sourced knowledge and growth stages.
--
-- Everything here is ADDITIVE. The columns/facts the recommender already uses
-- (name, slug, days_to_harvest, sun, water, climates, planting_months,
-- difficulty, i18n) are left exactly as they are, so nothing that works today
-- changes behaviour. New facts live in new columns and new tables.
--
-- Identity rule: one row per plant. "tomato", "tomatoes", "طماطم", "طماطة",
-- "بندورة" and "Solanum lycopersicum" are ALIASES of the single pl-tomato row,
-- never separate canonical rows.

-- --------------------------------------------------- plant_catalog facts ---
-- Canonical taxonomy + agronomic facts. Present but nullable so a lightly
-- documented plant can still be catalogued; the seeder fills what it knows.
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS scientific_name         text;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS accepted_name           text;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS family                  text;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS description             text;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS growth_duration_days    integer;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS germination_duration_days integer;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS temp_min_c              numeric(5, 1);
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS temp_max_c              numeric(5, 1);
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS soil_preferences        text;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS soil_ph_min             numeric(3, 1);
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS soil_ph_max             numeric(3, 1);
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS water_preferences       text;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS sunlight_preferences    text;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS planting_season         text;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS harvest_window          text;
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS seed_available          boolean NOT NULL DEFAULT true;
-- Which growth-stage template this plant follows (see plant_growth_stages).
ALTER TABLE plant_catalog ADD COLUMN IF NOT EXISTS stage_template          text;

-- ------------------------------------------------------------- aliases ----
-- Every name a member might type, in every language we support, folded to one
-- plant. normalized_alias is the search key: lowercased, de-diacriticised,
-- Arabic letter forms unified and the definite article stripped (see
-- services/plant-normalize.service.js).
--
-- UNIQUE(normalized_alias, language) is deliberate: an alias resolves to
-- exactly one plant, which is what makes search deterministic. Ambiguous
-- colloquial names are disambiguated by using the qualified form.
CREATE TABLE IF NOT EXISTS plant_aliases (
  alias_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id         text NOT NULL REFERENCES plant_catalog(id) ON DELETE CASCADE,
  language         text NOT NULL,
  alias            text NOT NULL,
  normalized_alias text NOT NULL,
  source           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_alias, language)
);
CREATE INDEX IF NOT EXISTS plant_aliases_plant_idx ON plant_aliases(plant_id);
CREATE INDEX IF NOT EXISTS plant_aliases_normalized_idx ON plant_aliases(normalized_alias);

-- ----------------------------------------------------------- varieties ----
CREATE TABLE IF NOT EXISTS plant_varieties (
  variety_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id              text NOT NULL REFERENCES plant_catalog(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  description           text,
  growth_duration_days  integer,
  special_requirements  text,
  i18n                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plant_id, name)
);
CREATE INDEX IF NOT EXISTS plant_varieties_plant_idx ON plant_varieties(plant_id);

-- --------------------------------------------- knowledge provenance -------
-- Every structured fact points at where it came from. source_id is the short
-- slug used in plants.json (e.g. powo, ecocrop, greenomy).
CREATE TABLE IF NOT EXISTS knowledge_sources (
  source_id    text PRIMARY KEY,
  name         text NOT NULL,
  url          text,
  organization text,
  type         text,
  accessed_at  date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------- plant knowledge ----
-- Structured facts. NOT an LLM's memory: the value column is the source of
-- truth the assistant is told to answer exact numbers from. source_id is NOT
-- NULL (defaulting to the editorial 'greenomy' source) so the unique key makes
-- re-seeding idempotent — a NULL would defeat ON CONFLICT.
CREATE TABLE IF NOT EXISTS plant_knowledge (
  knowledge_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id       text NOT NULL REFERENCES plant_catalog(id) ON DELETE CASCADE,
  knowledge_type text NOT NULL,
  value          jsonb NOT NULL,
  unit           text,
  source_id      text NOT NULL REFERENCES knowledge_sources(source_id) ON DELETE SET DEFAULT DEFAULT 'greenomy',
  confidence     numeric(3, 2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plant_id, knowledge_type, source_id)
);
CREATE INDEX IF NOT EXISTS plant_knowledge_plant_idx ON plant_knowledge(plant_id);

-- ------------------------------------------------------ growth stages -----
-- The stages a journey walks through. plant_id NULL means a TEMPLATE row that
-- applies to every plant using that template; a non-NULL plant_id overrides it
-- for one plant. This is what keeps schedules configurable instead of hardcoded
-- for a single plant.
CREATE TABLE IF NOT EXISTS plant_growth_stages (
  stage_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id          text REFERENCES plant_catalog(id) ON DELETE CASCADE,
  template          text NOT NULL,
  stage_key         text NOT NULL,
  label_en          text NOT NULL,
  label_ar          text,
  label_ku          text,
  sort_order        integer NOT NULL,
  -- Days after planting, relative to the plant's own durations — a window, not
  -- a fixed date, so a journey milestone is never "every 7 days".
  expected_day_from integer,
  expected_day_to   integer,
  description       text
);
-- COALESCE so template rows (plant_id NULL) still collide on re-seed.
CREATE UNIQUE INDEX IF NOT EXISTS plant_growth_stages_unique
  ON plant_growth_stages (template, stage_key, COALESCE(plant_id, ''));
CREATE INDEX IF NOT EXISTS plant_growth_stages_plant_idx ON plant_growth_stages(plant_id);

-- ------------------------------------------- link user plants (no loss) ---
-- A member's plants keep their free-text plant_type; these add a canonical
-- link when the name can be resolved. Nothing is deleted or merged.
ALTER TABLE plants ADD COLUMN IF NOT EXISTS canonical_plant_id text REFERENCES plant_catalog(id) ON DELETE SET NULL;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS variety_id uuid REFERENCES plant_varieties(variety_id) ON DELETE SET NULL;
ALTER TABLE plants ADD COLUMN IF NOT EXISTS custom_name text;
CREATE INDEX IF NOT EXISTS plants_canonical_plant_idx ON plants(canonical_plant_id);
