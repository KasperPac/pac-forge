-- FDS Co-Author: Per-assembly interactive spec building + subsystem orchestration

-- ============================================================
-- fds_assembly_sessions — per-assembly co-authoring state
-- ============================================================
CREATE TABLE fds_assembly_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE NOT NULL,

  -- Assembly reference (matches ids in confirmed_subsystems JSONB)
  subsystem_id TEXT NOT NULL,
  assembly_id TEXT NOT NULL,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'static_confirmed', 'in_progress', 'complete')),

  -- Auto-filled static states (confirmed or overridden by engineer)
  -- Shape: { [state_id]: [{ tag, description, state }] }
  static_states JSONB DEFAULT '{}',
  static_confirmed BOOLEAN DEFAULT FALSE,

  -- Sequential states built via conversation
  -- Shape: { [state_id]: { permissives: [], steps: [], notes: null } }
  sequential_states JSONB DEFAULT '{}',

  -- Conversation history (full audit trail)
  -- Shape: [{ role, content, timestamp, state_context?, table_delta? }]
  conversation JSONB DEFAULT '[]',

  -- Duplicate tracking
  duplicated_from UUID REFERENCES fds_assembly_sessions(id) ON DELETE SET NULL,
  tag_remap JSONB DEFAULT '{}',

  -- Logic checker results (last run)
  validation_results JSONB DEFAULT NULL,

  -- Token usage
  token_usage JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One session per assembly per project
  UNIQUE (spec_project_id, subsystem_id, assembly_id)
);

ALTER TABLE fds_assembly_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own fds_assembly_sessions"
  ON fds_assembly_sessions FOR ALL
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

CREATE INDEX idx_fds_sessions_project ON fds_assembly_sessions(spec_project_id, subsystem_id);

CREATE TRIGGER set_fds_assembly_sessions_updated_at
  BEFORE UPDATE ON fds_assembly_sessions
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- fds_subsystem_orchestrations — how assemblies coordinate
-- ============================================================
CREATE TABLE fds_subsystem_orchestrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE NOT NULL,

  subsystem_id TEXT NOT NULL,

  -- Per-state orchestration
  -- Shape: { [state_id]: { assembly_order, shared_permissives, inter_assembly_interlocks, notes } }
  state_sequences JSONB DEFAULT '{}',

  -- Conversation history
  conversation JSONB DEFAULT '[]',

  -- Validation results
  validation_results JSONB DEFAULT NULL,

  -- Token usage
  token_usage JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One orchestration per subsystem per project
  UNIQUE (spec_project_id, subsystem_id)
);

ALTER TABLE fds_subsystem_orchestrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own fds_subsystem_orchestrations"
  ON fds_subsystem_orchestrations FOR ALL
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

CREATE TRIGGER set_fds_subsystem_orchestrations_updated_at
  BEFORE UPDATE ON fds_subsystem_orchestrations
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
