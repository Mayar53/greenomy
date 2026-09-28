-- 011_engagement.sql — the plant journey grows into a full engagement system:
-- care actions, care streaks, garden XP/levels, achievements, seasonal
-- challenges, mystery rewards and an inventory of unlocked items.
--
-- Design rules, the same ones the points system already follows:
--   * every table that can pay a reward carries a UNIQUE key, so a replay can
--     never double-award and a refreshed page can never re-claim;
--   * nothing here decides HOW MUCH anything is worth — that lives in
--     engagement.json and services/engagement-config.service.js;
--   * garden XP is separate from spendable points on purpose: XP is earned and
--     never spent, points are the wallet currency redeemed with partners.

-- Garden progression + care streak live on the member.
ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime_xp integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS care_streak_days integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS care_streak_last date;

-- One row per recorded care action. The unique key means care counts once per
-- plant, per action, per day, so a streak cannot be farmed by resubmitting.
CREATE TABLE IF NOT EXISTS care_actions (
  care_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  plant_id    uuid NOT NULL REFERENCES plants(plant_id) ON DELETE CASCADE,
  action_type text NOT NULL,
  note        text,
  care_date   date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  xp_awarded  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, plant_id, action_type, care_date)
);
CREATE INDEX IF NOT EXISTS care_actions_user_idx ON care_actions(user_id, care_date DESC);
CREATE INDEX IF NOT EXISTS care_actions_plant_idx ON care_actions(plant_id);

-- What a member owns: seeds, garden decorations, profile items, plant facts,
-- garden items and rare items. Quantity accumulates per (member, type, key).
CREATE TABLE IF NOT EXISTS user_inventory (
  item_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  item_type         text NOT NULL,
  item_key          text NOT NULL,
  quantity          integer NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  first_acquired_at timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_type, item_key)
);
CREATE INDEX IF NOT EXISTS user_inventory_user_idx ON user_inventory(user_id, item_type);

-- The idempotency ledger for engagement rewards, mirroring reward_awards.
-- grant_type names the SOURCE (milestone|achievement|challenge|streak) and
-- reference_id the exact thing (a milestone id, an achievement id, ...). A
-- mystery grant is created 'pending' and only becomes 'claimed' once — and the
-- second claim finds no pending row to flip.
CREATE TABLE IF NOT EXISTS reward_grants (
  grant_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  grant_type      text NOT NULL,
  reference_id    text NOT NULL,
  source_plant_id uuid REFERENCES plants(plant_id) ON DELETE SET NULL,
  mystery         boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'pending', 'claimed')),
  pool            text,
  payload         jsonb,
  xp              integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  UNIQUE (user_id, grant_type, reference_id)
);
CREATE INDEX IF NOT EXISTS reward_grants_user_idx ON reward_grants(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reward_grants_pending_idx ON reward_grants(user_id) WHERE status = 'pending';

-- Achievements are defined in engagement.json; this records who unlocked what,
-- and the unique key is what stops a second unlock.
CREATE TABLE IF NOT EXISTS user_achievements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  achievement_id text NOT NULL,
  unlocked_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, achievement_id)
);

-- Per-member progress on a seasonal challenge. progress is a cached snapshot;
-- the requirement is re-derived from real activity, never trusted from here.
CREATE TABLE IF NOT EXISTS user_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  challenge_id text NOT NULL,
  progress     integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  claimed_at   timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, challenge_id)
);

-- Temporary XP boosts. A boost is live while expires_at is in the future.
CREATE TABLE IF NOT EXISTS user_boosts (
  boost_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  multiplier       numeric(4, 2) NOT NULL DEFAULT 1.5,
  source_reference text NOT NULL,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_reference)
);
