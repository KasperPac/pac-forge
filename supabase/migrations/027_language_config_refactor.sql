-- Migration 027: Granular language configuration for design profiles
-- Renames code_language → device_fb_language, adds io_linking_language,
-- removes MIXED as a valid value.

-- 1. Fix any existing MIXED values before altering constraints
UPDATE design_profiles SET code_language = 'SCL' WHERE code_language = 'MIXED';
UPDATE design_profiles SET process_code_language = 'SCL' WHERE process_code_language = 'MIXED';

-- 2. Rename code_language → device_fb_language
ALTER TABLE design_profiles RENAME COLUMN code_language TO device_fb_language;

-- 3. Add io_linking_language with default SCL
ALTER TABLE design_profiles
  ADD COLUMN IF NOT EXISTS io_linking_language TEXT NOT NULL DEFAULT 'SCL';

-- 4. Backfill io_linking_language from device_fb_language
UPDATE design_profiles SET io_linking_language = device_fb_language;
