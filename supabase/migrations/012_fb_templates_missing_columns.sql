-- ============================================================
-- 012: Add missing columns to fb_templates
-- plc_brand and tags may be missing on some deployments
-- where migration 003 didn't fully apply
-- ============================================================

ALTER TABLE fb_templates ADD COLUMN IF NOT EXISTS plc_brand text NOT NULL DEFAULT 'SIEMENS_TIA';
ALTER TABLE fb_templates ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
