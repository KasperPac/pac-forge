-- Template PLCSIM test procedures per device type and FB
-- Reusable test templates included verbatim when a matching device/FB is used in a project

CREATE TABLE IF NOT EXISTS plcsim_test_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- Scope: category-level OR specific FB template (at least one must be set)
  device_category text,                    -- e.g. "Motor" — matches any FB of this category
  fb_template_id uuid REFERENCES fb_templates(id) ON DELETE SET NULL,
  description text,
  -- The test procedure — JSONB matching PlcsimTestCase shape (steps, actions, simRules)
  test_case jsonb NOT NULL,
  -- Tag parameterization rules for resolving placeholders per device instance
  tag_mappings jsonb DEFAULT '[]'::jsonb,
  is_enabled boolean DEFAULT true,
  version integer DEFAULT 1,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT at_least_one_scope CHECK (device_category IS NOT NULL OR fb_template_id IS NOT NULL)
);

-- Profile scoping junction (zero rows = global, N rows = scoped to those profiles)
CREATE TABLE IF NOT EXISTS plcsim_test_template_profile_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES plcsim_test_templates(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES design_profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (template_id, profile_id)
);

-- RLS
ALTER TABLE plcsim_test_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can read test templates') THEN
    CREATE POLICY "Authenticated users can read test templates"
      ON plcsim_test_templates FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can insert test templates') THEN
    CREATE POLICY "Authenticated users can insert test templates"
      ON plcsim_test_templates FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can update test templates') THEN
    CREATE POLICY "Authenticated users can update test templates"
      ON plcsim_test_templates FOR UPDATE USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can delete test templates') THEN
    CREATE POLICY "Authenticated users can delete test templates"
      ON plcsim_test_templates FOR DELETE USING (auth.role() = 'authenticated');
  END IF;
END $$;

ALTER TABLE plcsim_test_template_profile_tags ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can read test template profile tags') THEN
    CREATE POLICY "Authenticated users can read test template profile tags"
      ON plcsim_test_template_profile_tags FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can insert test template profile tags') THEN
    CREATE POLICY "Authenticated users can insert test template profile tags"
      ON plcsim_test_template_profile_tags FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can update test template profile tags') THEN
    CREATE POLICY "Authenticated users can update test template profile tags"
      ON plcsim_test_template_profile_tags FOR UPDATE USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can delete test template profile tags') THEN
    CREATE POLICY "Authenticated users can delete test template profile tags"
      ON plcsim_test_template_profile_tags FOR DELETE USING (auth.role() = 'authenticated');
  END IF;
END $$;
