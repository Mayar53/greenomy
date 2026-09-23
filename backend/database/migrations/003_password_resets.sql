-- 003_password_resets.sql — single-use, time-limited password reset tokens.
-- Only the SHA-256 hash of the token is stored, so a database leak does not
-- hand out working reset links.

CREATE TABLE IF NOT EXISTS password_resets (
  reset_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets(user_id);
