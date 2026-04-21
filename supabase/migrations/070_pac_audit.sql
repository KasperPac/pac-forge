-- ============================================================
-- 070_pac_audit.sql
-- Pac-Audit: reverse-engineering module for existing TIA Portal projects
-- ============================================================

-- ============================================================
-- audit_projects — master record for each audited TIA project
-- ============================================================
CREATE TABLE audit_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  design_profile_id uuid REFERENCES design_profiles(id) ON DELETE SET NULL,

  name text NOT NULL,
  description text,
  tia_project_path text NOT NULL,
  tia_version text,
  cpu_order_number text,
  cpu_family text,

  extraction_status text NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'extracting', 'extracted', 'failed')),
  extracted_at timestamptz,
  extraction_stats jsonb DEFAULT '{}',

  current_step text NOT NULL DEFAULT 'connect',
  step_statuses jsonb DEFAULT '{}',

  analysis_progress jsonb DEFAULT '{}',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_projects_user_id ON audit_projects(user_id);
CREATE INDEX idx_audit_projects_project_id ON audit_projects(project_id);

ALTER TABLE audit_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_projects_select_own" ON audit_projects
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "audit_projects_insert_own" ON audit_projects
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "audit_projects_update_own" ON audit_projects
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "audit_projects_delete_own" ON audit_projects
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER audit_projects_updated_at
  BEFORE UPDATE ON audit_projects
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);


-- ============================================================
-- audit_folders — block group / folder tree (recursive)
-- ============================================================
CREATE TABLE audit_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  parent_folder_id uuid REFERENCES audit_folders(id) ON DELETE CASCADE,

  name text NOT NULL,
  folder_type text NOT NULL DEFAULT 'program_blocks'
    CHECK (folder_type IN (
      'program_blocks', 'system_blocks', 'tag_tables',
      'udt', 'hmi_screens', 'technology_objects'
    )),
  path text NOT NULL,
  depth int NOT NULL DEFAULT 0,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_folders_project ON audit_folders(audit_project_id);
CREATE INDEX idx_audit_folders_parent ON audit_folders(parent_folder_id);
CREATE INDEX idx_audit_folders_path ON audit_folders(audit_project_id, path);

ALTER TABLE audit_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_folders_all_own" ON audit_folders
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_blocks — every PLC block extracted from the project
-- ============================================================
CREATE TABLE audit_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES audit_folders(id) ON DELETE SET NULL,

  name text NOT NULL,
  block_type text NOT NULL
    CHECK (block_type IN ('FB', 'FC', 'OB', 'DB', 'UDT', 'SFB', 'SFC')),
  block_number int,
  programming_language text NOT NULL
    CHECK (programming_language IN ('SCL', 'LAD', 'FBD', 'STL', 'GRAPH', 'DB', 'UDT')),

  source_code text,
  source_format text NOT NULL DEFAULT 'scl'
    CHECK (source_format IN ('scl', 'xml', 'awl')),

  interface_definition jsonb DEFAULT '{}',

  analysis_status text NOT NULL DEFAULT 'extracted'
    CHECK (analysis_status IN (
      'extracted', 'queued', 'analyzing', 'understood',
      'modified', 'testing', 'tested', 'failed'
    )),
  analysis_error text,
  analyzed_at timestamptz,

  line_count int,
  complexity_score int,

  compile_status text DEFAULT 'unknown'
    CHECK (compile_status IN ('unknown', 'clean', 'errors', 'warnings')),
  compile_errors jsonb DEFAULT '[]',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_blocks_project ON audit_blocks(audit_project_id);
CREATE INDEX idx_audit_blocks_folder ON audit_blocks(folder_id);
CREATE INDEX idx_audit_blocks_status ON audit_blocks(audit_project_id, analysis_status);
CREATE INDEX idx_audit_blocks_type ON audit_blocks(audit_project_id, block_type);
CREATE INDEX idx_audit_blocks_name ON audit_blocks(audit_project_id, name);

ALTER TABLE audit_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_blocks_all_own" ON audit_blocks
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));

CREATE TRIGGER audit_blocks_updated_at
  BEFORE UPDATE ON audit_blocks
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);


-- ============================================================
-- audit_block_understanding — AI's deep analysis per block
-- ============================================================
CREATE TABLE audit_block_understanding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES audit_blocks(id) ON DELETE CASCADE,
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,

  purpose text,
  category text,
  complexity_rating text
    CHECK (complexity_rating IN ('trivial', 'simple', 'moderate', 'complex', 'very_complex')),

  has_state_machine boolean DEFAULT false,
  state_machine jsonb DEFAULT NULL,

  data_flow jsonb DEFAULT '{}',
  timing_analysis jsonb DEFAULT '{}',
  fault_handling jsonb DEFAULT '{}',
  interface_contract jsonb DEFAULT '{}',
  code_quality jsonb DEFAULT '{}',

  detailed_notes text,

  model_used text,
  token_usage jsonb DEFAULT '{}',

  version int NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_block_understanding_block ON audit_block_understanding(block_id);
CREATE INDEX idx_block_understanding_current ON audit_block_understanding(block_id, is_current) WHERE is_current = true;
CREATE INDEX idx_block_understanding_project ON audit_block_understanding(audit_project_id);
CREATE INDEX idx_block_understanding_category ON audit_block_understanding(audit_project_id, category);

ALTER TABLE audit_block_understanding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_block_understanding_all_own" ON audit_block_understanding
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_cross_references — block-to-block relationships
-- ============================================================
CREATE TABLE audit_cross_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,

  source_block_id uuid NOT NULL REFERENCES audit_blocks(id) ON DELETE CASCADE,
  target_block_id uuid NOT NULL REFERENCES audit_blocks(id) ON DELETE CASCADE,

  reference_type text NOT NULL
    CHECK (reference_type IN (
      'calls', 'instantiates', 'reads', 'writes',
      'uses_type', 'inherits', 'triggers', 'references_tag'
    )),

  reference_details jsonb DEFAULT '{}',
  reference_count int DEFAULT 1,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_xref_project ON audit_cross_references(audit_project_id);
CREATE INDEX idx_xref_source ON audit_cross_references(source_block_id);
CREATE INDEX idx_xref_target ON audit_cross_references(target_block_id);
CREATE INDEX idx_xref_type ON audit_cross_references(audit_project_id, reference_type);
CREATE INDEX idx_xref_target_type ON audit_cross_references(target_block_id, reference_type);

ALTER TABLE audit_cross_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_cross_references_all_own" ON audit_cross_references
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_tag_tables — PLC tag tables
-- ============================================================
CREATE TABLE audit_tag_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,

  name text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]',
  tag_count int NOT NULL DEFAULT 0,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_tag_tables_project ON audit_tag_tables(audit_project_id);

ALTER TABLE audit_tag_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_tag_tables_all_own" ON audit_tag_tables
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_hardware_config — extracted hardware configuration
-- ============================================================
CREATE TABLE audit_hardware_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,

  devices jsonb NOT NULL DEFAULT '[]',
  io_modules jsonb NOT NULL DEFAULT '[]',
  networks jsonb NOT NULL DEFAULT '[]',
  drives jsonb NOT NULL DEFAULT '[]',
  hmi_panels jsonb NOT NULL DEFAULT '[]',
  safety_config jsonb DEFAULT '{}',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_hw_project ON audit_hardware_config(audit_project_id);

ALTER TABLE audit_hardware_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_hardware_config_all_own" ON audit_hardware_config
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_hmi_screens — extracted HMI screen data
-- ============================================================
CREATE TABLE audit_hmi_screens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,

  name text NOT NULL,
  screen_number int,
  folder_path text,
  width int,
  height int,

  content_xml text,
  content_json jsonb DEFAULT '{}',

  tag_bindings jsonb DEFAULT '[]',

  purpose text,
  connected_blocks text[],

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_hmi_project ON audit_hmi_screens(audit_project_id);

ALTER TABLE audit_hmi_screens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_hmi_screens_all_own" ON audit_hmi_screens
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_naming_conventions — detected patterns
-- ============================================================
CREATE TABLE audit_naming_conventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,

  convention_type text NOT NULL
    CHECK (convention_type IN (
      'block_naming', 'tag_naming', 'variable_naming',
      'folder_structure', 'db_naming', 'comment_style',
      'numbering_scheme', 'io_addressing'
    )),

  pattern text NOT NULL,
  description text NOT NULL,
  examples text[] DEFAULT '{}',
  confidence real NOT NULL DEFAULT 0.0
    CHECK (confidence >= 0.0 AND confidence <= 1.0),
  occurrence_count int DEFAULT 0,
  total_count int DEFAULT 0,

  deviations jsonb DEFAULT '[]',

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_naming_project ON audit_naming_conventions(audit_project_id);
CREATE INDEX idx_audit_naming_type ON audit_naming_conventions(audit_project_id, convention_type);

ALTER TABLE audit_naming_conventions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_naming_conventions_all_own" ON audit_naming_conventions
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_modifications — change history per block
-- ============================================================
CREATE TABLE audit_modifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES audit_blocks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),

  modification_type text NOT NULL
    CHECK (modification_type IN (
      'source_edit', 'interface_change', 'refactor',
      'bugfix', 'optimization', 'comment_update', 'reimport'
    )),

  description text NOT NULL,
  source_before text,
  source_after text,
  diff_hunks jsonb DEFAULT '[]',

  ai_assisted boolean DEFAULT false,
  ai_model text,
  ai_prompt text,

  reimported_to_tia boolean DEFAULT false,
  reimport_result jsonb DEFAULT NULL,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_mods_project ON audit_modifications(audit_project_id);
CREATE INDEX idx_audit_mods_block ON audit_modifications(block_id);
CREATE INDEX idx_audit_mods_user ON audit_modifications(user_id);
CREATE INDEX idx_audit_mods_created ON audit_modifications(audit_project_id, created_at DESC);

ALTER TABLE audit_modifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_modifications_all_own" ON audit_modifications
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_impact_analyses — pre-computed impact graphs
-- ============================================================
CREATE TABLE audit_impact_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  trigger_block_id uuid NOT NULL REFERENCES audit_blocks(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),

  change_type text NOT NULL DEFAULT 'general'
    CHECK (change_type IN ('general', 'interface_change', 'delete', 'rename', 'logic_change')),
  change_description text,

  directly_affected jsonb NOT NULL DEFAULT '[]',
  indirectly_affected jsonb NOT NULL DEFAULT '[]',
  hmi_affected jsonb DEFAULT '[]',
  tag_affected jsonb DEFAULT '[]',

  risk_level text DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  summary text,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_impact_project ON audit_impact_analyses(audit_project_id);
CREATE INDEX idx_audit_impact_trigger ON audit_impact_analyses(trigger_block_id);

ALTER TABLE audit_impact_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_impact_analyses_all_own" ON audit_impact_analyses
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_test_runs — test execution sessions
-- ============================================================
CREATE TABLE audit_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),

  test_environment text NOT NULL DEFAULT 'plcsim'
    CHECK (test_environment IN ('plcsim', 'physical_plc')),
  plcsim_instance_name text,
  plc_ip_address text,

  tested_block_ids uuid[] DEFAULT '{}',
  modification_ids uuid[] DEFAULT '{}',

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,

  test_suite jsonb DEFAULT '{}',
  summary jsonb DEFAULT '{}',

  notes text,
  error_message text,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_test_runs_project ON audit_test_runs(audit_project_id);
CREATE INDEX idx_audit_test_runs_status ON audit_test_runs(audit_project_id, status);

ALTER TABLE audit_test_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_test_runs_all_own" ON audit_test_runs
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- audit_conversations — AI chat threads
-- ============================================================
CREATE TABLE audit_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  block_id uuid REFERENCES audit_blocks(id) ON DELETE SET NULL,

  context_type text NOT NULL DEFAULT 'general'
    CHECK (context_type IN ('general', 'onboarding', 'block_analysis', 'modification', 'impact_review')),
  title text,

  messages jsonb NOT NULL DEFAULT '[]',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_conversations_project ON audit_conversations(audit_project_id);
CREATE INDEX idx_audit_conversations_block ON audit_conversations(block_id);

ALTER TABLE audit_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_conversations_all_own" ON audit_conversations
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));

CREATE TRIGGER audit_conversations_updated_at
  BEFORE UPDATE ON audit_conversations
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);


-- ============================================================
-- audit_libraries — global/project libraries
-- ============================================================
CREATE TABLE audit_libraries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_project_id uuid NOT NULL REFERENCES audit_projects(id) ON DELETE CASCADE,

  library_type text NOT NULL DEFAULT 'project'
    CHECK (library_type IN ('project', 'global')),
  name text NOT NULL,
  path text,
  items jsonb NOT NULL DEFAULT '[]',

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_libraries_project ON audit_libraries(audit_project_id);

ALTER TABLE audit_libraries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_libraries_all_own" ON audit_libraries
  FOR ALL TO authenticated
  USING (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ))
  WITH CHECK (audit_project_id IN (
    SELECT id FROM audit_projects WHERE user_id = auth.uid()
  ));


-- ============================================================
-- Views
-- ============================================================

CREATE OR REPLACE VIEW audit_call_graph AS
SELECT
  xr.audit_project_id,
  sb.name AS caller_name,
  sb.block_type AS caller_type,
  tb.name AS callee_name,
  tb.block_type AS callee_type,
  xr.reference_type,
  xr.reference_count
FROM audit_cross_references xr
JOIN audit_blocks sb ON sb.id = xr.source_block_id
JOIN audit_blocks tb ON tb.id = xr.target_block_id;

CREATE OR REPLACE VIEW audit_blocks_with_understanding AS
SELECT
  b.*,
  u.purpose,
  u.category,
  u.complexity_rating,
  u.has_state_machine,
  u.state_machine,
  u.data_flow,
  u.fault_handling,
  u.code_quality
FROM audit_blocks b
LEFT JOIN audit_block_understanding u
  ON u.block_id = b.id AND u.is_current = true;


-- ============================================================
-- RPC: recursive impact chain
-- ============================================================
CREATE OR REPLACE FUNCTION get_block_impact_chain(
  p_block_id uuid,
  p_max_depth int DEFAULT 5
)
RETURNS TABLE (
  block_id uuid,
  block_name text,
  block_type text,
  depth int,
  path_from_source text[]
)
LANGUAGE sql STABLE
AS $$
  WITH RECURSIVE impact_chain AS (
    SELECT
      xr.source_block_id AS block_id,
      b.name AS block_name,
      b.block_type,
      1 AS depth,
      ARRAY[b.name] AS path_from_source
    FROM audit_cross_references xr
    JOIN audit_blocks b ON b.id = xr.source_block_id
    WHERE xr.target_block_id = p_block_id

    UNION

    SELECT
      xr.source_block_id,
      b.name,
      b.block_type,
      ic.depth + 1,
      ic.path_from_source || b.name
    FROM audit_cross_references xr
    JOIN audit_blocks b ON b.id = xr.source_block_id
    JOIN impact_chain ic ON xr.target_block_id = ic.block_id
    WHERE ic.depth < p_max_depth
      AND NOT (b.name = ANY(ic.path_from_source))
  )
  SELECT DISTINCT ON (block_id) * FROM impact_chain
  ORDER BY block_id, depth;
$$;
