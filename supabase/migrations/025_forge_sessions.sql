-- Forge Wizard: forge_sessions table and design_profile extensions
-- Stores wizard pipeline state, step data, and generated artifacts per session

CREATE TABLE forge_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  design_profile_id uuid REFERENCES design_profiles,
  current_step text NOT NULL DEFAULT 'spec_upload',

  -- Step data (JSONB for flexibility during rapid development)
  spec_text text,                          -- Extracted functional spec text
  spec_filename text,                      -- Original filename
  spec_analysis jsonb DEFAULT '{}',        -- AI-parsed project overview, devices, IO

  hardware_config jsonb DEFAULT '{}',      -- CPU, rack/slot, IO modules
  io_list jsonb DEFAULT '[]',              -- Confirmed IO entries
  device_list jsonb DEFAULT '[]',          -- Confirmed devices with FB assignments
  network_topology jsonb DEFAULT '{}',     -- Network architecture

  linkage_matrix jsonb,                    -- Device wiring / process sequence data

  -- Generated artifacts per stage
  device_artifacts jsonb DEFAULT '[]',     -- Generated FBs, DBs, IO wiring
  process_artifacts jsonb DEFAULT '[]',    -- Generated process code
  hmi_artifacts jsonb DEFAULT '[]',        -- Generated HMI screens

  -- Step completion tracking
  step_statuses jsonb DEFAULT '{}',        -- { step_name: "pending"|"active"|"completed"|"failed" }

  -- TIA export tracking
  tia_project_path text,
  tia_export_result jsonb,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_forge_sessions_project_id ON forge_sessions (project_id);
CREATE INDEX idx_forge_sessions_user_id ON forge_sessions (user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_forge_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER forge_sessions_updated_at
  BEFORE UPDATE ON forge_sessions
  FOR EACH ROW EXECUTE FUNCTION update_forge_sessions_updated_at();

-- RLS
ALTER TABLE forge_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "forge_sessions_select_own" ON forge_sessions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "forge_sessions_insert_own" ON forge_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "forge_sessions_update_own" ON forge_sessions
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "forge_sessions_delete_own" ON forge_sessions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Extend design_profiles with wizard-relevant fields
ALTER TABLE design_profiles ADD COLUMN IF NOT EXISTS code_language text NOT NULL DEFAULT 'SCL';
ALTER TABLE design_profiles ADD COLUMN IF NOT EXISTS process_code_language text NOT NULL DEFAULT 'SCL';
ALTER TABLE design_profiles ADD COLUMN IF NOT EXISTS hmi_theme text NOT NULL DEFAULT 'default';
ALTER TABLE design_profiles ADD COLUMN IF NOT EXISTS naming_prefix text NOT NULL DEFAULT '';
ALTER TABLE design_profiles ADD COLUMN IF NOT EXISTS db_naming_prefix text NOT NULL DEFAULT '';

COMMENT ON COLUMN design_profiles.code_language IS 'Primary code language for device FBs: SCL | LAD | MIXED';
COMMENT ON COLUMN design_profiles.process_code_language IS 'Language for process/sequence code: SCL | LAD | MIXED';
COMMENT ON COLUMN design_profiles.hmi_theme IS 'HMI screen theme identifier (e.g. default, dark, customer-specific)';
COMMENT ON COLUMN design_profiles.naming_prefix IS 'FB/FC naming prefix for customer (e.g. FB_CK_)';
COMMENT ON COLUMN design_profiles.db_naming_prefix IS 'DB naming prefix for customer (e.g. DB_CK_)';
