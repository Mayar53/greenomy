-- 006_plant_journeys.sql — a member's plant can become a journey with growth
-- milestones.
--
-- Milestones are STAGE-based, not a calendar: their windows are computed from
-- the plant's own germination period and days-to-harvest, so a tomato and a
-- lemon tree get different schedules and nothing is "every 7 days".

CREATE TABLE IF NOT EXISTS journeys (
  journey_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_plant_id          uuid NOT NULL REFERENCES plants(plant_id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  started_at             timestamptz NOT NULL DEFAULT now(),
  expected_duration_days integer,
  current_stage          text NOT NULL DEFAULT 'planting',
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  completed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- One journey per plant: re-requesting one returns the existing journey
  -- instead of silently creating a second that could double-award rewards.
  UNIQUE (user_plant_id)
);
CREATE INDEX IF NOT EXISTS journeys_user_idx ON journeys(user_id);

CREATE TABLE IF NOT EXISTS journey_milestones (
  milestone_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id          uuid NOT NULL REFERENCES journeys(journey_id) ON DELETE CASCADE,
  stage_key           text NOT NULL,
  label_en            text NOT NULL,
  sort_order          integer NOT NULL,
  -- Days after planting. A window, so a milestone is "when it should happen",
  -- not a fixed date.
  expected_day_from   integer,
  expected_day_to     integer,
  recommended_window  text,
  completed_at        timestamptz,
  verification_status text NOT NULL DEFAULT 'none'
                      CHECK (verification_status IN ('none', 'pending', 'verified', 'rejected')),
  verification_id     uuid REFERENCES verifications(verification_id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, stage_key)
);
CREATE INDEX IF NOT EXISTS journey_milestones_journey_idx ON journey_milestones(journey_id);
