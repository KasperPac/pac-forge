-- Add device_call_fc_language column to design_profiles and forge_sessions.
-- Controls whether CALL_xxx FCs (one per device type) are generated as SCL or LAD.

ALTER TABLE design_profiles
  ADD COLUMN IF NOT EXISTS device_call_fc_language TEXT NOT NULL DEFAULT 'SCL';

ALTER TABLE forge_sessions
  ADD COLUMN IF NOT EXISTS device_call_fc_language TEXT CHECK (device_call_fc_language IN ('SCL', 'LAD'));
