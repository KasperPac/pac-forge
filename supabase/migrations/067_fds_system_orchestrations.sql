-- Wave A: system-level cross-subsystem coordination
--
-- Adds `fds_system_orchestrations` (one row per spec_project) to hold the
-- cross-subsystem layer — shared permissives, inter-subsystem interlocks,
-- subsystem ordering per sequential state. Also extends
-- `_build_contract_snapshot` (defined in 066) so the snapshot carries a
-- `system_orchestration` key alongside the existing per-subsystem
-- `orchestrations` map.

-- ============================================================
-- fds_system_orchestrations — project-wide cross-subsystem coordination
-- ============================================================
CREATE TABLE IF NOT EXISTS fds_system_orchestrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id uuid NOT NULL REFERENCES spec_projects(id) ON DELETE CASCADE,
  -- state_sequences[state_id] -> { subsystem_order, shared_permissives,
  --   inter_subsystem_interlocks, notes }
  state_sequences jsonb NOT NULL DEFAULT '{}'::jsonb,
  conversation jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_results jsonb,
  token_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (spec_project_id)
);

COMMENT ON TABLE fds_system_orchestrations IS
  'Project-scoped cross-subsystem coordination. One row per spec_project_id. state_sequences[state_id] = { subsystem_order, shared_permissives, inter_subsystem_interlocks, notes }';

-- ============================================================
-- RLS — mirror fds_subsystem_orchestrations / fds_assembly_sessions pattern
-- ============================================================
ALTER TABLE fds_system_orchestrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own fds_system_orchestrations"
  ON fds_system_orchestrations FOR SELECT
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users insert own fds_system_orchestrations"
  ON fds_system_orchestrations FOR INSERT
  WITH CHECK (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users update own fds_system_orchestrations"
  ON fds_system_orchestrations FOR UPDATE
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  )
  WITH CHECK (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users delete own fds_system_orchestrations"
  ON fds_system_orchestrations FOR DELETE
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

-- updated_at trigger — same pattern used in 054/061/064
CREATE TRIGGER fds_system_orchestrations_updated_at
  BEFORE UPDATE ON fds_system_orchestrations
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- Extend _build_contract_snapshot to include system_orchestration
-- ============================================================
-- Preserves every field assembled in migration 066; only adds the new key.
CREATE OR REPLACE FUNCTION _build_contract_snapshot(p_spec_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project jsonb;
  v_hierarchy jsonb;
  v_states jsonb;
  v_alarm_tiers jsonb;
  v_sections jsonb;
  v_assemblies jsonb;
  v_orchestrations jsonb;
  v_alarms jsonb;
  v_system_orch jsonb;
BEGIN
  SELECT to_jsonb(sp.*),
         COALESCE(sp.confirmed_subsystems, '[]'::jsonb),
         COALESCE(sp.confirmed_states, '[]'::jsonb),
         COALESCE(sp.alarm_tiers, '[]'::jsonb)
    INTO v_project, v_hierarchy, v_states, v_alarm_tiers
    FROM spec_projects sp
   WHERE sp.id = p_spec_project_id;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'spec_projects row % not found', p_spec_project_id;
  END IF;

  SELECT COALESCE(jsonb_object_agg(section_type, rows), '{}'::jsonb)
    INTO v_sections
    FROM (
      SELECT section_type,
             jsonb_agg(to_jsonb(s.*)) AS rows
        FROM spec_sections s
       WHERE s.spec_project_id = p_spec_project_id
       GROUP BY section_type
    ) t;

  SELECT COALESCE(jsonb_object_agg(assembly_id, row_json), '{}'::jsonb)
    INTO v_assemblies
    FROM (
      SELECT assembly_id::text AS assembly_id, to_jsonb(f.*) AS row_json
        FROM fds_assembly_sessions f
       WHERE f.spec_project_id = p_spec_project_id
    ) t;

  SELECT COALESCE(jsonb_object_agg(subsystem_id, row_json), '{}'::jsonb)
    INTO v_orchestrations
    FROM (
      SELECT subsystem_id::text AS subsystem_id, to_jsonb(o.*) AS row_json
        FROM fds_subsystem_orchestrations o
       WHERE o.spec_project_id = p_spec_project_id
    ) t;

  SELECT to_jsonb(so.*)
    INTO v_system_orch
    FROM fds_system_orchestrations so
   WHERE so.spec_project_id = p_spec_project_id
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(a.*)), '[]'::jsonb)
    INTO v_alarms
    FROM spec_alarms a
   WHERE a.spec_project_id = p_spec_project_id;

  RETURN jsonb_build_object(
    'schema_version',        2,
    'project',               v_project,
    'hierarchy',             jsonb_build_object('subsystems', v_hierarchy),
    'states',                v_states,
    'alarm_tiers',           v_alarm_tiers,
    'sections',              v_sections,
    'assemblies',            v_assemblies,
    'orchestrations',        v_orchestrations,
    'system_orchestration',  v_system_orch,
    'alarms',                v_alarms
  );
END;
$$;

COMMENT ON FUNCTION _build_contract_snapshot(uuid)
  IS 'Internal: assembles a minimal SpecContractV2-shaped snapshot from live tables. Includes system_orchestration (wave A / migration 067).';

GRANT EXECUTE ON FUNCTION _build_contract_snapshot(uuid) TO authenticated;
