-- Design Profiles: per-customer code generation rule sets
CREATE TABLE design_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_name text,
  plc_brand text NOT NULL DEFAULT 'SIEMENS_TIA',
  rules text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE design_profiles ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "design_profiles_select" ON design_profiles
  FOR SELECT TO authenticated USING (true);

-- Any authenticated user can insert
CREATE POLICY "design_profiles_insert" ON design_profiles
  FOR INSERT TO authenticated WITH CHECK (true);

-- Creators can update their own
CREATE POLICY "design_profiles_update_own" ON design_profiles
  FOR UPDATE TO authenticated USING (created_by = auth.uid());

-- Creators can delete their own
CREATE POLICY "design_profiles_delete_own" ON design_profiles
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- Link projects to design profiles
ALTER TABLE projects ADD COLUMN IF NOT EXISTS design_profile_id uuid REFERENCES design_profiles;

-- Functional description columns for process code generation
ALTER TABLE projects ADD COLUMN IF NOT EXISTS functional_description text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS functional_description_filename text;
