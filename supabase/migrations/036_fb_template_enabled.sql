-- Add is_enabled flag to fb_templates
-- Allows per-library enable/disable so PM only sees enabled templates

ALTER TABLE fb_templates
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT true;

-- Index for fast PM queries (filter to enabled only)
CREATE INDEX IF NOT EXISTS idx_fb_templates_enabled
  ON fb_templates (is_enabled)
  WHERE is_enabled = true;
