-- Spec Contract V2: foundation migration (Wave 1)
-- Additive only. No destructive drops. Legacy columns (state_name,
-- static_states, etc.) remain until a later migration (066) removes them.

-- ============================================================
-- spec_projects — add schema versioning + revision pointers
-- ============================================================
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS schema_version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS current_draft_revision_id uuid,
  ADD COLUMN IF NOT EXISTS latest_approved_revision_id uuid;

COMMENT ON COLUMN spec_projects.schema_version IS 'Contract schema version. 1 = legacy v1; 2 = SpecContractV2.';
COMMENT ON COLUMN spec_projects.current_draft_revision_id IS 'Forward-declared FK to spec_project_revisions(id); constraint added in migration 065.';
COMMENT ON COLUMN spec_projects.latest_approved_revision_id IS 'Forward-declared FK to spec_project_revisions(id); constraint added in migration 065.';

-- ============================================================
-- spec_sections — v2 addressing (assembly × state) + granularity
-- ============================================================
ALTER TABLE spec_sections
  ADD COLUMN IF NOT EXISTS state_id text,
  ADD COLUMN IF NOT EXISTS assembly_id uuid,
  ADD COLUMN IF NOT EXISTS state_pattern text
    CHECK (state_pattern IS NULL OR state_pattern IN ('static','sequential')),
  ADD COLUMN IF NOT EXISTS granularity text NOT NULL DEFAULT 'assembly_state'
    CHECK (granularity IN ('assembly_state','subsystem','project'));

COMMENT ON COLUMN spec_sections.state_id IS 'State id (e.g. "ST03"); writers enforce non-null when section_type=functional_description.';
COMMENT ON COLUMN spec_sections.assembly_id IS 'Assembly uuid; writers enforce non-null when section_type=functional_description.';
COMMENT ON COLUMN spec_sections.state_pattern IS 'static | sequential; null for non-functional sections.';
COMMENT ON COLUMN spec_sections.granularity IS 'Scope of this section: assembly_state | subsystem | project.';

CREATE INDEX IF NOT EXISTS idx_spec_sections_assy_state
  ON spec_sections(spec_project_id, assembly_id, state_id)
  WHERE section_type = 'functional_description';

-- ============================================================
-- fds_assembly_sessions — v2 static state shape (keyed by state_id)
-- ============================================================
ALTER TABLE fds_assembly_sessions
  ADD COLUMN IF NOT EXISTS static_states_v2 jsonb;

COMMENT ON COLUMN fds_assembly_sessions.static_states_v2 IS 'V2 static states shape, keyed by state_id. Legacy static_states column retained until migration 066.';

-- ============================================================
-- spec_alarms — normalised alarm rows per spec project
-- ============================================================
CREATE TABLE IF NOT EXISTS spec_alarms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id uuid NOT NULL REFERENCES spec_projects(id) ON DELETE CASCADE,

  -- References to structures that live as JSON (not FK-enforced)
  tier_id text,           -- references alarm_tiers JSON on spec_projects
  device_id uuid,         -- conceptual FK only (devices are JSON)
  assembly_id uuid,       -- conceptual FK only
  subsystem_id uuid,      -- conceptual FK only

  tag text NOT NULL,
  description text,
  action text,
  setpoint text,
  delay text,
  cause_effect jsonb,

  source text NOT NULL DEFAULT 'builder'
    CHECK (source IN ('builder','ingest','forge-readback')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE spec_alarms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own spec_alarms"
  ON spec_alarms FOR SELECT
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users insert own spec_alarms"
  ON spec_alarms FOR INSERT
  WITH CHECK (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users update own spec_alarms"
  ON spec_alarms FOR UPDATE
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  )
  WITH CHECK (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users delete own spec_alarms"
  ON spec_alarms FOR DELETE
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_spec_alarms_project
  ON spec_alarms(spec_project_id);

CREATE INDEX IF NOT EXISTS idx_spec_alarms_device
  ON spec_alarms(spec_project_id, device_id);

CREATE TRIGGER set_spec_alarms_updated_at
  BEFORE UPDATE ON spec_alarms
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
