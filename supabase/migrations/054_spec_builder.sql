-- Spec Builder: Functional specification document generation
-- Tables: spec_projects, instrument_registers, spec_sections, spec_exports

-- ============================================================
-- spec_projects — master record for each functional specification
-- ============================================================
CREATE TABLE spec_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users NOT NULL DEFAULT auth.uid(),

  -- Document metadata
  doc_code TEXT NOT NULL,
  revision TEXT NOT NULL DEFAULT '01',
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  project_number TEXT,
  issued_by TEXT,
  verified_by TEXT,
  approved_by TEXT,
  doc_date DATE DEFAULT CURRENT_DATE,

  -- Control system
  plc_model TEXT,
  hmi_type TEXT,
  comms_protocol TEXT,

  -- Design profile link (optional)
  design_profile_id UUID REFERENCES design_profiles(id) ON DELETE SET NULL,

  -- Wizard state (persisted for resume)
  confirmed_subsystems JSONB DEFAULT '[]',
  confirmed_states JSONB DEFAULT '[]',
  alarm_tiers JSONB DEFAULT '[
    {"tier_id":"immediate_shutdown","tier_name":"Immediate Shutdown","description":"Causes immediate de-energisation of all outputs"},
    {"tier_id":"controlled_shutdown","tier_name":"Controlled Shutdown","description":"Initiates a controlled stop sequence"},
    {"tier_id":"warning","tier_name":"Warning","description":"Alerts operator, no automatic action"},
    {"tier_id":"interlock","tier_name":"Interlock","description":"Prevents start or specific action"}
  ]',

  -- Status
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generating', 'review', 'complete')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE spec_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own spec_projects"
  ON spec_projects FOR ALL
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE TRIGGER set_spec_projects_updated_at
  BEFORE UPDATE ON spec_projects
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- instrument_registers — parsed tag register for a spec project
-- ============================================================
CREATE TABLE instrument_registers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE NOT NULL,

  raw_filename TEXT,
  parsed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Parsed tags: [{ tag, device_type, device_class, subsystem, description, signal_type, io_address, signal_direction, is_safety, subsystem_prefix }]
  tags JSONB NOT NULL DEFAULT '[]',

  -- Subsystem groupings: [{ subsystem_id, subsystem_name, equipment_type, tag_count }]
  subsystems JSONB NOT NULL DEFAULT '[]',

  -- Warnings for ambiguous rows
  parse_warnings JSONB DEFAULT '[]',

  -- Token usage tracking
  haiku_usage JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE instrument_registers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own instrument_registers"
  ON instrument_registers FOR ALL
  USING (
    spec_project_id IN (
      SELECT id FROM spec_projects WHERE created_by = auth.uid()
    )
  )
  WITH CHECK (
    spec_project_id IN (
      SELECT id FROM spec_projects WHERE created_by = auth.uid()
    )
  );

-- ============================================================
-- spec_sections — generated sections of the specification
-- ============================================================
CREATE TABLE spec_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE NOT NULL,

  section_type TEXT NOT NULL
    CHECK (section_type IN (
      'introduction',
      'equipment_description',
      'functional_state',
      'alarm_table',
      'settings_table',
      'audit_report'
    )),

  subsystem_id TEXT,
  state_name TEXT,

  -- Generated content
  content_json JSONB NOT NULL DEFAULT '{}',
  content_markdown TEXT,

  -- Generation metadata
  model_used TEXT,
  generation_prompt TEXT,
  token_usage JSONB DEFAULT '{}',

  -- Review state
  reviewed_by TEXT,
  review_notes TEXT,
  approved BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE spec_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own spec_sections"
  ON spec_sections FOR ALL
  USING (
    spec_project_id IN (
      SELECT id FROM spec_projects WHERE created_by = auth.uid()
    )
  )
  WITH CHECK (
    spec_project_id IN (
      SELECT id FROM spec_projects WHERE created_by = auth.uid()
    )
  );

CREATE INDEX idx_spec_sections_project ON spec_sections(spec_project_id, section_type);

CREATE TRIGGER set_spec_sections_updated_at
  BEFORE UPDATE ON spec_sections
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- spec_exports — tracks DOCX exports
-- ============================================================
CREATE TABLE spec_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE NOT NULL,
  revision TEXT NOT NULL,
  exported_at TIMESTAMPTZ DEFAULT NOW(),
  exported_by TEXT,
  storage_path TEXT,
  page_count INT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'failed'))
);

ALTER TABLE spec_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own spec_exports"
  ON spec_exports FOR ALL
  USING (
    spec_project_id IN (
      SELECT id FROM spec_projects WHERE created_by = auth.uid()
    )
  )
  WITH CHECK (
    spec_project_id IN (
      SELECT id FROM spec_projects WHERE created_by = auth.uid()
    )
  );
