-- 051: Add IO architecture mode to design profiles

ALTER TABLE design_profiles
  ADD COLUMN IF NOT EXISTS io_linking_mode text NOT NULL DEFAULT 'buffered_db';
