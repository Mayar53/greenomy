-- 013_verification_journey_integrity.sql — the anti-fraud gaps the audit found.
--
-- Three things were missing from the photo pipeline:
--
--   * a milestone could be photographed out of order, so a member could skip
--     straight to the final stage and claim a mature plant with no evidence of
--     the earlier growth;
--   * nothing compared a new photo with the plant's EARLIER stages, so a photo of
--     a different plant (someone else's, or the street) read as a fresh stage;
--   * the per-attempt code proved a photo was taken now, but every attempt asked
--     for the same thing, so one photo could satisfy it.
--
-- Additive only: no column is dropped, no row is rewritten, existing submissions
-- keep working (the new columns are nullable).

-- The randomised instruction the member is asked to follow for THIS attempt
-- ("photograph it from the side with the whole container visible", ...).
ALTER TABLE verification_challenges ADD COLUMN IF NOT EXISTS instruction text;

-- The continuity verdict for a submission: how close it is to the plant's
-- previous stage photos, and what that implies. Stored on the verification for
-- the reviewer; never shown to the member.
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS continuity_distance integer;
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS continuity_status text;

ALTER TABLE verifications DROP CONSTRAINT IF EXISTS verifications_continuity_status_check;
ALTER TABLE verifications ADD CONSTRAINT verifications_continuity_status_check
  CHECK (continuity_status IS NULL OR continuity_status IN ('first', 'consistent', 'inconsistent'));

-- Finding a plant's earlier stage photos is now a hot path on every submission.
CREATE INDEX IF NOT EXISTS verifications_plant_idx ON verifications(plant_id);
CREATE INDEX IF NOT EXISTS verifications_milestone_idx ON verifications(milestone_id);
