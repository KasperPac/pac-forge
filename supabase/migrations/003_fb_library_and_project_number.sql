-- FB Library: company-wide reusable function block templates
CREATE TABLE fb_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  device_category text NOT NULL,
  plc_brand text NOT NULL DEFAULT 'SIEMENS_TIA',
  description text,
  base_scl text NOT NULL,
  parameters jsonb DEFAULT '{}',
  tags text[] DEFAULT '{}',
  created_by uuid REFERENCES auth.users,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE fb_templates ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "fb_templates_select" ON fb_templates
  FOR SELECT TO authenticated USING (true);

-- Any authenticated user can insert
CREATE POLICY "fb_templates_insert" ON fb_templates
  FOR INSERT TO authenticated WITH CHECK (true);

-- Creators can update their own
CREATE POLICY "fb_templates_update_own" ON fb_templates
  FOR UPDATE TO authenticated USING (created_by = auth.uid());

-- Admins can update any
CREATE POLICY "fb_templates_update_admin" ON fb_templates
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'ADMIN')
  );

-- Creators can delete their own
CREATE POLICY "fb_templates_delete_own" ON fb_templates
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- Admins can delete any
CREATE POLICY "fb_templates_delete_admin" ON fb_templates
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'ADMIN')
  );

-- Add project_number to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_number text;
