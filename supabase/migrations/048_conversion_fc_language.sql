-- Add conversion_fc_language column to design_profiles and forge_sessions.
-- Controls whether FC_TypeConvert (datatype conversion between process signals and FB params)
-- is generated as SCL or LAD.

ALTER TABLE design_profiles
  ADD COLUMN IF NOT EXISTS conversion_fc_language TEXT NOT NULL DEFAULT 'SCL';

ALTER TABLE forge_sessions
  ADD COLUMN IF NOT EXISTS conversion_fc_language TEXT CHECK (conversion_fc_language IN ('SCL', 'LAD'));
