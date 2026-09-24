-- 009_plant_icon.sql — the catalogue's picture column is an icon key, not an emoji.
--
-- Every plant used to carry one emoji. An emoji renders differently on each
-- device, cannot take the palette's colour and cannot be sized to the grid, so
-- the frontend now draws a matched inline SVG instead (see icons.js) chosen from
-- a small vocabulary: leafy, root, fruit, herb, tree, pot.
--
-- The column keeps its role — one glyph key per plant — under an honest name.
-- Only the name changes here; the values are rewritten by the catalogue seed
-- (npm run seed), which is idempotent, so this is safe to run before or after.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'plant_catalog' AND column_name = 'emoji'
  ) THEN
    ALTER TABLE plant_catalog RENAME COLUMN emoji TO icon;
  END IF;
END $$;
