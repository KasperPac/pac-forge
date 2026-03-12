-- Add io_linking_rules column to design_profiles
-- Allows per-profile specification of IO linking style (e.g. LAD contact/coil vs MOVE boxes)

ALTER TABLE design_profiles
  ADD COLUMN IF NOT EXISTS io_linking_rules TEXT NOT NULL DEFAULT '';
