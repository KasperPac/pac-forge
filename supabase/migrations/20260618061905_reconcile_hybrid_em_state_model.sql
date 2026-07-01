-- NOTE: This migration was applied to the remote (Pac-Forge-v2) out-of-band on
-- 2026-06-18 and was missing from the repo. Reconstructed verbatim from
-- supabase_migrations.schema_migrations (version 20260618061905) on 2026-07-01 so
-- the repo is a complete record. Already recorded as applied on remote.

-- Catch-up: reconcile remote (ran 093, skipped 091) to the hybrid-EM-state-model schema.
-- Idempotent (guarded renames; IF EXISTS/IF NOT EXISTS).

-- 1. fds_assembly_sessions column renames (old table name still present)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fds_assembly_sessions' AND column_name='subsystem_id') THEN
    ALTER TABLE fds_assembly_sessions RENAME COLUMN subsystem_id TO unit_id; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fds_assembly_sessions' AND column_name='assembly_id') THEN
    ALTER TABLE fds_assembly_sessions RENAME COLUMN assembly_id TO equipment_module_id; END IF;
END $$;

-- 2. spec_sections + spec_alarms column renames
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='spec_sections' AND column_name='subsystem_id') THEN
    ALTER TABLE spec_sections RENAME COLUMN subsystem_id TO unit_id; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='spec_sections' AND column_name='assembly_id') THEN
    ALTER TABLE spec_sections RENAME COLUMN assembly_id TO equipment_module_id; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='spec_alarms' AND column_name='subsystem_id') THEN
    ALTER TABLE spec_alarms RENAME COLUMN subsystem_id TO unit_id; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='spec_alarms' AND column_name='assembly_id') THEN
    ALTER TABLE spec_alarms RENAME COLUMN assembly_id TO equipment_module_id; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='spec_alarms' AND column_name='device_id') THEN
    ALTER TABLE spec_alarms RENAME COLUMN device_id TO control_module_id; END IF;
END $$;

-- 3. fb_templates rename
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fb_templates' AND column_name='is_assembly') THEN
    ALTER TABLE fb_templates RENAME COLUMN is_assembly TO is_equipment_module; END IF;
END $$;

-- 4. new columns (091 process_model + hybrid safety_gates)
ALTER TABLE spec_projects ADD COLUMN IF NOT EXISTS process_model jsonb DEFAULT NULL;
ALTER TABLE spec_projects ADD COLUMN IF NOT EXISTS safety_gates jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 5. drop stale indexes, rename constraint, rename table
DROP INDEX IF EXISTS idx_fds_sessions_project;
DROP INDEX IF EXISTS idx_spec_sections_assy_state;
DROP INDEX IF EXISTS idx_spec_alarms_device;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fds_assembly_sessions_project_assembly_key') THEN
    ALTER TABLE fds_assembly_sessions RENAME CONSTRAINT fds_assembly_sessions_project_assembly_key
      TO fds_operation_sessions_project_equipment_module_key; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='fds_assembly_sessions') THEN
    ALTER TABLE fds_assembly_sessions RENAME TO fds_operation_sessions; END IF;
END $$;

-- 6. hybrid per-EM columns on the renamed table
ALTER TABLE fds_operation_sessions ADD COLUMN IF NOT EXISTS em_states jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE fds_operation_sessions ADD COLUMN IF NOT EXISTS em_transitions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 7. recreate indexes + RLS policy under ISA-88 names
CREATE INDEX IF NOT EXISTS idx_fds_operation_sessions_project ON fds_operation_sessions(spec_project_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_spec_sections_equip_module_state
  ON spec_sections(spec_project_id, equipment_module_id, state_id) WHERE section_type='functional_description';
CREATE INDEX IF NOT EXISTS idx_spec_alarms_control_module ON spec_alarms(spec_project_id, control_module_id);
DROP POLICY IF EXISTS "Users manage own fds_assembly_sessions" ON fds_operation_sessions;
CREATE POLICY "Users manage own fds_operation_sessions" ON fds_operation_sessions FOR ALL
  USING (spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid()))
  WITH CHECK (spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid()));

-- 8. drop obsolete orchestration tables
DROP TABLE IF EXISTS fds_subsystem_orchestrations CASCADE;
DROP TABLE IF EXISTS fds_system_orchestrations CASCADE;

-- 9. hybrid _build_contract_snapshot
CREATE OR REPLACE FUNCTION public._build_contract_snapshot(p_spec_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_project jsonb; v_hierarchy jsonb; v_alarm_tiers jsonb; v_sections jsonb;
        v_equipment_modules jsonb; v_alarms jsonb; v_safety_gates jsonb;
BEGIN
  SELECT to_jsonb(sp.*), COALESCE(sp.confirmed_units,'[]'::jsonb),
         COALESCE(sp.alarm_tiers,'[]'::jsonb), COALESCE(sp.safety_gates,'[]'::jsonb)
    INTO v_project, v_hierarchy, v_alarm_tiers, v_safety_gates
    FROM spec_projects sp WHERE sp.id = p_spec_project_id;
  IF v_project IS NULL THEN RAISE EXCEPTION 'spec_projects row % not found', p_spec_project_id; END IF;
  SELECT COALESCE(jsonb_object_agg(section_type, rows),'{}'::jsonb) INTO v_sections
    FROM (SELECT section_type, jsonb_agg(to_jsonb(s.*)) AS rows FROM spec_sections s
           WHERE s.spec_project_id = p_spec_project_id GROUP BY section_type) t;
  SELECT COALESCE(jsonb_object_agg(equipment_module_id, row_json),'{}'::jsonb) INTO v_equipment_modules
    FROM (SELECT equipment_module_id::text AS equipment_module_id, to_jsonb(f.*) AS row_json
            FROM fds_operation_sessions f WHERE f.spec_project_id = p_spec_project_id) t;
  SELECT COALESCE(jsonb_agg(to_jsonb(a.*)),'[]'::jsonb) INTO v_alarms
    FROM spec_alarms a WHERE a.spec_project_id = p_spec_project_id;
  RETURN jsonb_build_object(
    'schema_version', 3, 'project', v_project,
    'hierarchy', jsonb_build_object('units', v_hierarchy),
    'alarm_tiers', v_alarm_tiers, 'safety_gates', v_safety_gates,
    'sections', v_sections, 'equipment_modules', v_equipment_modules,
    'io_list', '[]'::jsonb, 'faults', '[]'::jsonb, 'alarms', v_alarms);
END $fn$;
GRANT EXECUTE ON FUNCTION public._build_contract_snapshot(uuid) TO authenticated;

-- 10. reconcile migration history
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('091','isa88_rename'), ('20260618032808','hybrid_em_state_model'),
       ('20260618032809','hybrid_snapshot_and_drop_orchestration')
ON CONFLICT (version) DO NOTHING;
