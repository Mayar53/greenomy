-- 012_email_case_insensitive.sql — one address is one account.
--
-- Until now signup stored the address verbatim and every lookup matched it
-- exactly, while users.email was UNIQUE case-sensitively. So signing up as
-- Mayarraws@gmail.com and later seeding/looking up mayarraws@gmail.com produced
-- TWO accounts for one person, and logging in only worked with the exact case
-- originally typed.
--
-- This canonicalises existing rows and then makes a case-insensitive duplicate
-- impossible at the database level. The API normalises on the way in as well
-- (models/user.model.js), so this index is the backstop, not the only guard.
--
-- NOTE: if a database already holds two rows that differ only by case, the
-- UPDATE below fails on the existing UNIQUE(email) constraint. That is
-- deliberate — merging two accounts is a data decision with real consequences
-- (plants, points, redemptions), so it must be done knowingly rather than
-- silently by a migration.

UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
