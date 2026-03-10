-- Expand design_profiles with categorized rule fields
-- Migrate existing "rules" content into "general_rules"

ALTER TABLE design_profiles
  ADD COLUMN IF NOT EXISTS general_rules text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS folder_rules text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS process_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fb_rules jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Migrate existing rules into general_rules
UPDATE design_profiles
SET general_rules = rules
WHERE rules IS NOT NULL AND rules <> '';

-- process_rules schema: [{ "label": "...", "example": "...", "analysis": "..." }, ...]
-- fb_rules schema: same as process_rules

COMMENT ON COLUMN design_profiles.general_rules IS 'Rules applied to all generation paths (naming, comments, structure)';
COMMENT ON COLUMN design_profiles.folder_rules IS 'TIA Portal program group/folder structure rules';
COMMENT ON COLUMN design_profiles.process_rules IS 'Process code structure rules with example code and AI analysis. JSON array of {label, example, analysis}';
COMMENT ON COLUMN design_profiles.fb_rules IS 'Function block structure rules with example code and AI analysis. JSON array of {label, example, analysis}';
