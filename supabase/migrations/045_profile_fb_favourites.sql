-- Add fb_favourites JSONB column to design_profiles
-- Stores a map of device_type → template_id for preferred FB templates per device type
ALTER TABLE design_profiles
  ADD COLUMN IF NOT EXISTS fb_favourites JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN design_profiles.fb_favourites IS
  'Map of device_type (string) → fb_template_id (uuid string). '
  'When set, the forge pipeline assigns this template directly without scoring.';
