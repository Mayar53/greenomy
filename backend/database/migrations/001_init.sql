-- 001_init.sql — Greenomy initial schema.
-- Ten core tables. Every statement is IF NOT EXISTS so the file is safe to
-- re-run; the runner also records applied files in schema_migrations.
--
-- Note: the columns marked "not in docs/DATABASE.md" are already used by the
-- controllers and seed JSON today, so they are required, not optional extras.

-- gen_random_uuid() is built into PostgreSQL 13+, so no pgcrypto extension is
-- needed — which also keeps this file runnable on the PGlite dev driver.

-- ---------------------------------------------------------------- users ---
CREATE TABLE IF NOT EXISTS users (
  user_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  city          text,
  total_points  integer NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------- partners ---
-- name is UNIQUE so seeding from rewards.json is idempotent.
CREATE TABLE IF NOT EXISTS partners (
  partner_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  logo_url      text,
  website       text,
  description   text,
  contact_email text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------- plants ---
-- planting_method + location are NOT in docs/DATABASE.md but the new-seed
-- wizard sends them.
CREATE TABLE IF NOT EXISTS plants (
  plant_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  plant_type      text NOT NULL,
  planting_method text,
  stage           text NOT NULL DEFAULT 'seed',
  planting_date   timestamptz,
  location        text,
  last_watered    timestamptz,
  next_watering   timestamptz,
  status          text NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plants_user_id_idx ON plants(user_id);

-- -------------------------------------------------------- verifications ---
-- ai_provider + ai_metrics are NOT in docs/DATABASE.md but the verification
-- provider records them.
CREATE TABLE IF NOT EXISTS verifications (
  verification_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id            uuid NOT NULL REFERENCES plants(plant_id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  image_url           text NOT NULL,
  gps_lat             double precision,
  gps_long            double precision,
  captured_at         timestamptz,
  ai_confidence_score numeric(4, 2),
  ai_provider         text,
  ai_metrics          jsonb,
  approval_status     text NOT NULL DEFAULT 'pending'
                      CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  admin_reviewed_by   uuid REFERENCES users(user_id) ON DELETE SET NULL,
  rejection_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  reviewed_at         timestamptz
);
CREATE INDEX IF NOT EXISTS verifications_user_id_idx ON verifications(user_id);
CREATE INDEX IF NOT EXISTS verifications_plant_id_idx ON verifications(plant_id);
CREATE INDEX IF NOT EXISTS verifications_status_idx ON verifications(approval_status);

-- -------------------------------------------------------------- rewards ---
-- reward_id is TEXT and holds the stable rw-001 ids from rewards.json, so
-- seeds are idempotent and existing frontend ids keep working.
-- partner (display name), category and i18n are NOT in docs/DATABASE.md.
CREATE TABLE IF NOT EXISTS rewards (
  reward_id       text PRIMARY KEY,
  partner_id      uuid REFERENCES partners(partner_id) ON DELETE SET NULL,
  partner         text NOT NULL,
  category        text NOT NULL,
  title           text NOT NULL,
  description     text,
  image_url       text,
  points_required integer NOT NULL CHECK (points_required > 0),
  expires_at      timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  i18n            jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rewards_category_idx ON rewards(category);

-- ---------------------------------------------------------- redemptions ---
CREATE TABLE IF NOT EXISTS redemptions (
  redemption_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  reward_id        text NOT NULL REFERENCES rewards(reward_id),
  partner_id       uuid REFERENCES partners(partner_id) ON DELETE SET NULL,
  points_spent     integer NOT NULL,
  qr_code_hash     text,
  redemption_token text NOT NULL UNIQUE,
  is_used          boolean NOT NULL DEFAULT false,
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS redemptions_user_id_idx ON redemptions(user_id);

-- --------------------------------------------------- point_transactions ---
CREATE TABLE IF NOT EXISTS point_transactions (
  transaction_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  amount           integer NOT NULL,
  transaction_type text NOT NULL,
  description      text,
  reference_id     text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS point_transactions_user_id_idx ON point_transactions(user_id);

-- ------------------------------------------------------------- waitlist ---
-- email is UNIQUE; the controller maps a 23505 violation to 409.
CREATE TABLE IF NOT EXISTS waitlist (
  waitlist_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name           text NOT NULL,
  email               text NOT NULL UNIQUE,
  city                text NOT NULL,
  gardening_interests text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------- green_hub_content ---
-- body + i18n are NOT in docs/DATABASE.md; greenhub.json stores body as an
-- array of paragraphs and per-record AR/KU translations.
CREATE TABLE IF NOT EXISTS green_hub_content (
  content_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  title        text NOT NULL,
  description  text,
  category     text NOT NULL,
  content_type text NOT NULL DEFAULT 'article',
  body         jsonb,
  image_url    text,
  video_url    text,
  reading_time integer,
  is_published boolean NOT NULL DEFAULT true,
  i18n         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS green_hub_category_idx ON green_hub_content(category);

-- -------------------------------------------------------- notifications ---
CREATE TABLE IF NOT EXISTS notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title           text NOT NULL,
  message         text,
  type            text NOT NULL,
  is_read         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id);
