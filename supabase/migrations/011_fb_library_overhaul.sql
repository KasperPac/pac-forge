-- ============================================================
-- 011: FB Library Overhaul
-- Multi-block templates, dynamic categories, versioning, profile scoping
-- Fully idempotent — safe to re-run after partial apply
-- ============================================================

-- 1. Dynamic device categories (replaces hardcoded FB_DEVICE_CATEGORIES)
CREATE TABLE IF NOT EXISTS fb_device_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE fb_device_categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_device_categories_select') THEN
    CREATE POLICY "fb_device_categories_select" ON fb_device_categories FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_device_categories_insert') THEN
    CREATE POLICY "fb_device_categories_insert" ON fb_device_categories FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_device_categories_update') THEN
    CREATE POLICY "fb_device_categories_update" ON fb_device_categories FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_device_categories_delete') THEN
    CREATE POLICY "fb_device_categories_delete" ON fb_device_categories FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- Seed with existing 9 categories (skip if already exist)
INSERT INTO fb_device_categories (name, display_name, sort_order) VALUES
  ('Motor',           'Motors',           1),
  ('Sensor',          'Sensors',          2),
  ('Valve',           'Valves',           3),
  ('Pushbutton',      'Pushbuttons',      4),
  ('LightTower',      'Light Towers',     5),
  ('VFD',             'VFDs',             6),
  ('ConveyorSection', 'Conveyor Sections', 7),
  ('ZPASection',      'ZPA Sections',     8),
  ('Custom',          'Custom',           9)
ON CONFLICT (name) DO NOTHING;

-- 2. Multi-block child table
CREATE TABLE IF NOT EXISTS fb_template_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES fb_templates(id) ON DELETE CASCADE,
  block_name text NOT NULL,
  block_type text NOT NULL CHECK (block_type IN ('FB', 'FC', 'UDT', 'DB', 'OB')),
  scl_code text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE fb_template_blocks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_template_blocks_select') THEN
    CREATE POLICY "fb_template_blocks_select" ON fb_template_blocks FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_template_blocks_insert') THEN
    CREATE POLICY "fb_template_blocks_insert" ON fb_template_blocks FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_template_blocks_update') THEN
    CREATE POLICY "fb_template_blocks_update" ON fb_template_blocks FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_template_blocks_delete') THEN
    CREATE POLICY "fb_template_blocks_delete" ON fb_template_blocks FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fb_template_blocks_template ON fb_template_blocks(template_id);

-- 3. Version history
CREATE TABLE IF NOT EXISTS fb_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES fb_templates(id) ON DELETE CASCADE,
  version integer NOT NULL,
  blocks jsonb NOT NULL DEFAULT '[]',
  description text,
  tags text[] DEFAULT '{}',
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (template_id, version)
);

ALTER TABLE fb_template_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_template_versions_select') THEN
    CREATE POLICY "fb_template_versions_select" ON fb_template_versions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_template_versions_insert') THEN
    CREATE POLICY "fb_template_versions_insert" ON fb_template_versions FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_template_versions_delete') THEN
    CREATE POLICY "fb_template_versions_delete" ON fb_template_versions FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fb_template_versions_template ON fb_template_versions(template_id);

-- 4. Profile scoping junction table
CREATE TABLE IF NOT EXISTS fb_template_profile_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES fb_templates(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES design_profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (template_id, profile_id)
);

ALTER TABLE fb_template_profile_tags ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_template_profile_tags_select') THEN
    CREATE POLICY "fb_template_profile_tags_select" ON fb_template_profile_tags FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_template_profile_tags_insert') THEN
    CREATE POLICY "fb_template_profile_tags_insert" ON fb_template_profile_tags FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'fb_template_profile_tags_delete') THEN
    CREATE POLICY "fb_template_profile_tags_delete" ON fb_template_profile_tags FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fb_template_profile_tags_template ON fb_template_profile_tags(template_id);
CREATE INDEX IF NOT EXISTS idx_fb_template_profile_tags_profile ON fb_template_profile_tags(profile_id);

-- 5. Add version column to fb_templates
ALTER TABLE fb_templates ADD COLUMN IF NOT EXISTS version integer DEFAULT 1;

-- 6. Ensure tags column exists on fb_templates (may be missing on some deployments)
ALTER TABLE fb_templates ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- 7. Migrate existing base_scl data into fb_template_blocks (skip if already migrated)
INSERT INTO fb_template_blocks (template_id, block_name, block_type, scl_code, sort_order)
SELECT id, name, 'FB', base_scl, 0
FROM fb_templates
WHERE base_scl IS NOT NULL AND base_scl != ''
  AND NOT EXISTS (
    SELECT 1 FROM fb_template_blocks b WHERE b.template_id = fb_templates.id
  );

-- 8. Snapshot current state as version 1 (skip templates that already have a version snapshot)
INSERT INTO fb_template_versions (template_id, version, blocks, description, tags)
SELECT
  t.id,
  1,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
      'block_name', b.block_name,
      'block_type', b.block_type,
      'scl_code', b.scl_code,
      'sort_order', b.sort_order
    ) ORDER BY b.sort_order)
    FROM fb_template_blocks b WHERE b.template_id = t.id),
    '[]'::jsonb
  ),
  t.description,
  COALESCE(t.tags, '{}'::text[])
FROM fb_templates t
WHERE NOT EXISTS (
  SELECT 1 FROM fb_template_versions v WHERE v.template_id = t.id AND v.version = 1
);

-- 9. Drop old columns (base_scl, parameters) — they're now in fb_template_blocks
ALTER TABLE fb_templates DROP COLUMN IF EXISTS base_scl;
ALTER TABLE fb_templates DROP COLUMN IF EXISTS parameters;
