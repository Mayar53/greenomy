-- 008_rewards_idempotency.sql — the record of what has ALREADY been awarded.
--
-- The unique key is the authority that makes rewards idempotent: replaying an
-- approval, resubmitting the same milestone photo, or two admins acting at once
-- can never pay twice, because the second insert simply does not happen.
--
-- Nothing here decides how many points a thing is worth — that is a rule in
-- services/reward-engine.service.js. This table only records that a rule fired.

CREATE TABLE IF NOT EXISTS reward_awards (
  award_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  journey_id   uuid REFERENCES journeys(journey_id) ON DELETE SET NULL,
  milestone_id uuid REFERENCES journey_milestones(milestone_id) ON DELETE SET NULL,
  award_type   text NOT NULL CHECK (award_type IN (
                 'photo_verified', 'milestone_planting', 'milestone_growth', 'journey_completed')),
  points       integer NOT NULL CHECK (points > 0),
  -- What the award is FOR: a verification id, a milestone id or a journey id.
  -- NOT NULL so the unique key below is reliable (a NULL would not collide).
  reference_id text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, award_type, reference_id)
);
CREATE INDEX IF NOT EXISTS reward_awards_user_idx ON reward_awards(user_id);
CREATE INDEX IF NOT EXISTS reward_awards_journey_idx ON reward_awards(journey_id);
