-- 093_isa88_column_rename.sql
-- Complete the ISA-88 rename: align DB column names with the code (`units`).
-- Migration 091 renamed code/types to `units`/`confirmed_units` but left these
-- two columns at their pre-ISA-88 names, leaving the app's confirm/contract
-- paths writing a `confirmed_units` column that did not exist.
--
-- Only the COLUMN references change. The snapshot JSON key
-- `hierarchy.subsystems` (used by _build_contract_snapshot / revert_to_revision)
-- is an internal snapshot contract and is intentionally left unchanged so
-- existing stored snapshot_json rows keep round-tripping.

ALTER TABLE spec_projects        RENAME COLUMN confirmed_subsystems TO confirmed_units;
ALTER TABLE instrument_registers RENAME COLUMN subsystems           TO units;

-- _build_contract_snapshot: swap the spec_projects column reference.
CREATE OR REPLACE FUNCTION public._build_contract_snapshot(p_spec_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         COALESCE(sp.confirmed_units, '[]'::jsonb),
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
$function$;

-- revert_to_revision: swap the spec_projects column in the restore UPDATE.
CREATE OR REPLACE FUNCTION public.revert_to_revision(p_target_revision_id uuid)
 RETURNS spec_project_revisions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target spec_project_revisions;
  v_existing_draft uuid;
  v_row spec_project_revisions;
  v_snapshot jsonb;
  v_subsystems jsonb;
  v_states jsonb;
  v_tiers jsonb;
BEGIN
  SELECT * INTO v_target FROM spec_project_revisions WHERE id = p_target_revision_id;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'revision % not found', p_target_revision_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM spec_projects
     WHERE id = v_target.spec_project_id
       AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized for spec_project %', v_target.spec_project_id;
  END IF;

  IF v_target.status NOT IN ('approved', 'revised') THEN
    RAISE EXCEPTION 'revert_to_revision: target status must be approved or revised, got %', v_target.status;
  END IF;

  SELECT id INTO v_existing_draft
    FROM spec_project_revisions
   WHERE spec_project_id = v_target.spec_project_id
     AND status = 'draft';
  IF v_existing_draft IS NOT NULL THEN
    RAISE EXCEPTION 'draft revision already exists for spec_project %', v_target.spec_project_id
      USING ERRCODE = 'unique_violation';
  END IF;

  v_snapshot := v_target.snapshot_json;

  -- Restore the inline JSONB columns on spec_projects from the snapshot.
  v_subsystems := COALESCE(v_snapshot -> 'hierarchy' -> 'subsystems', '[]'::jsonb);
  v_states     := COALESCE(v_snapshot -> 'states', '[]'::jsonb);
  v_tiers      := COALESCE(v_snapshot -> 'alarm_tiers', '[]'::jsonb);

  UPDATE spec_projects
     SET confirmed_units  = v_subsystems,
         confirmed_states = v_states,
         alarm_tiers      = v_tiers
   WHERE id = v_target.spec_project_id;

  INSERT INTO spec_project_revisions (
    spec_project_id, revision_number, display_label, status, source,
    parent_revision_id, snapshot_json, created_by
  )
  VALUES (
    v_target.spec_project_id, 0, 'draft', 'draft', v_target.source,
    v_target.id, v_snapshot, auth.uid()
  )
  RETURNING * INTO v_row;

  UPDATE spec_projects
     SET current_draft_revision_id = v_row.id
   WHERE id = v_target.spec_project_id;

  RETURN v_row;
END;
$function$;
