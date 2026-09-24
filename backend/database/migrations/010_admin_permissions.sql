-- 010_admin_permissions.sql — admins hold named permissions, not just a role.
--
-- Two roles already existed (admin, super_admin) and every admin route shared one
-- blanket guard, so an admin could do anything in the dashboard. This adds the
-- finer axis: which parts of it an admin may touch.
--
-- super_admin is deliberately unchanged and always passes every check — it is the
-- owner account and the way back in if a grant is wrong.
--
-- Promotion is by email: the person must already have an account (see
-- controllers/admin-admins.controller.js), so there is no half-created admin row
-- and no invitation token to keep in sync.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}';
