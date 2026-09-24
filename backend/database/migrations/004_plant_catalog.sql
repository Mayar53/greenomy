-- 004_plant_catalog.sql — the plant catalog, plus the preferences that
-- onboarding already asks for but has never stored.
--
-- The catalog is real reference data (climate suitability, days to harvest,
-- planting months) rather than AI guesswork, so recommendations stay
-- deterministic, free and testable.

CREATE TABLE IF NOT EXISTS plant_catalog (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  category        text NOT NULL CHECK (category IN ('vegetables', 'herbs', 'fruit-trees', 'houseplants')),
  emoji           text,
  days_to_harvest integer NOT NULL CHECK (days_to_harvest > 0),
  difficulty      text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  indoor          boolean NOT NULL DEFAULT false,
  outdoor         boolean NOT NULL DEFAULT false,
  sun             text NOT NULL CHECK (sun IN ('full', 'partial', 'shade')),
  water           text NOT NULL CHECK (water IN ('low', 'medium', 'high')),
  -- Climate zones this plant grows well in, e.g. {temperate,mediterranean}.
  climates        text[] NOT NULL DEFAULT '{}',
  -- Northern-hemisphere months it can be sown. Empty means any month.
  planting_months integer[] NOT NULL DEFAULT '{}',
  notes           text,
  -- Per-locale name/notes, keyed ar / ku, matching rewards.json and greenhub.json.
  i18n            jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plant_catalog_category_idx ON plant_catalog(category);

-- Preferences collected by eco-profile.html, which until now were written to
-- sessionStorage and deleted when the seed wizard finished.
-- Explicit columns with a CHECK, matching how users.role and users.status are
-- constrained, rather than an unvalidated jsonb blob.
ALTER TABLE users ADD COLUMN IF NOT EXISTS experience  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plant_types text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests   text[] NOT NULL DEFAULT '{}';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_experience_check;
ALTER TABLE users ADD CONSTRAINT users_experience_check
  CHECK (experience IS NULL OR experience IN ('beginner', 'some-experience', 'experienced', 'expert'));
