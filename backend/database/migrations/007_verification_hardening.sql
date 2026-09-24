-- 007_verification_hardening.sql — reward-grade photo verification: a
-- per-attempt challenge, server-computed image hashes for duplicate detection,
-- and a structured verification result.
--
-- No single model decides authenticity here. The columns added to verifications
-- record the DECISION and the SIGNALS behind it, so an admin can see why a photo
-- was flagged instead of trusting a bare "real/fake" verdict.

-- ------------------------------------------------------- challenges -------
-- A fresh code per attempt (never static), short-lived and single-use. The
-- member photographs their plant with the current code visible.
CREATE TABLE IF NOT EXISTS verification_challenges (
  challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  plant_id     uuid REFERENCES plants(plant_id) ON DELETE CASCADE,
  code         text NOT NULL,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz
);
CREATE INDEX IF NOT EXISTS verification_challenges_user_idx ON verification_challenges(user_id);

-- ----------------------------------------------------- image hashes -------
-- One row per submitted image. sha256 is intentionally NOT unique: the same
-- bytes may legitimately be re-submitted, and we want to RECORD and flag that
-- rather than fail the insert. Duplicate detection is a query over this table,
-- across all users, not just the submitter's own history.
CREATE TABLE IF NOT EXISTS verification_images (
  image_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid REFERENCES verifications(verification_id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  sha256          text NOT NULL,
  -- Perceptual hashes (hex, 64-bit) for near-duplicate detection.
  phash           text,
  dhash           text,
  ahash           text,
  width           integer,
  height          integer,
  bytes           integer,
  mime            text,
  -- Content-addressed filename (sha256 + extension) under IMAGE_STORAGE_DIR.
  storage_path    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_images_sha_idx ON verification_images(sha256);
CREATE INDEX IF NOT EXISTS verification_images_user_idx ON verification_images(user_id);

-- ------------------------------------------- verifications: new signals ---
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS image_sha256      text;
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS storage_path      text;
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS challenge_id      uuid REFERENCES verification_challenges(challenge_id) ON DELETE SET NULL;
-- Link a photo to the journey milestone it is evidence for, when there is one.
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS milestone_id      uuid REFERENCES journey_milestones(milestone_id) ON DELETE SET NULL;
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS duplicate_status  text NOT NULL DEFAULT 'none';
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS requires_review   boolean NOT NULL DEFAULT false;
-- The structured, multi-signal result (plantMatch, challengePassed,
-- journeyConsistency, suspicious, ...) — not a single confidence number.
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS verification_result jsonb;

CREATE INDEX IF NOT EXISTS verifications_sha_idx ON verifications(image_sha256);
CREATE INDEX IF NOT EXISTS verifications_review_idx ON verifications(requires_review);

ALTER TABLE verifications DROP CONSTRAINT IF EXISTS verifications_duplicate_status_check;
ALTER TABLE verifications ADD CONSTRAINT verifications_duplicate_status_check
  CHECK (duplicate_status IN ('none', 'exact', 'near', 'review'));
