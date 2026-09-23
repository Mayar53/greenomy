-- 002_notifications.sql — push notification device tokens.
-- Notifications themselves already live in the `notifications` table; this adds
-- the per-user device registrations that push delivery fans out to.

CREATE TABLE IF NOT EXISTS device_tokens (
  token_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  platform     text NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'ios', 'android')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_tokens_user_id_idx ON device_tokens(user_id);
