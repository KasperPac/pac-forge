-- =============================================================================
-- Migration: hybrid_snapshot_and_drop_orchestration
-- Part of: hybrid-EM-state-model (Task 13)
--
-- PURPOSE
--   1. Replaces _build_contract_snapshot with a version that matches the
--      SpecContractV2Schema (schema_version 3) target shape introduced by
--      the hybrid per-EM state model design.
--   2. Drops the obsolete cross-subsystem orchestration tables
--      (fds_unit_procedures / fds_system_procedures) that are no longer
--      represented in the contract.
--
-- PREREQUISITE — READ BEFORE APPLYING
--   This file MUST be applied AFTER the ISA-88 table-rename reconciliation
--   is complete on the target database. Specifically, the remote DB must have:
--
--     a) Table renames from migration 091 applied:
--          fds_assembly_sessions       → fds_operation_sessions
--          fds_subsystem_orchestrations → fds_unit_procedures
--          fds_system_orchestrations   → fds_system_procedures
--        (These are the names the DROP TABLE statements below target.)
--
--     b) Column rename from migration 20260617001222 applied:
--          spec_projects.confirmed_subsystems → confirmed_units
--        (The function body reads confirmed_units.)
--
--     c) Columns added by migration 20260618032808 applied:
--          spec_projects.safety_gates       jsonb NOT NULL DEFAULT '[]'
--          fds_operation_sessions.em_states      jsonb NOT NULL DEFAULT '[]'
--          fds_operation_sessions.em_transitions jsonb NOT NULL DEFAULT '[]'
--
--   The remote DB is in a drifted migration state (migrations 091 and
--   20260617001222 were NOT applied there). The user must reconcile table and
--   column existence before running this file. This file was authored but NOT
--   auto-applied for that reason.
--
-- SCHEMA CHANGES SUMMARY
--   _build_contract_snapshot output (prior → new):
--     schema_version      : 2          → 3
--     hierarchy key       : 'subsystems'→ 'units'
--     REMOVED keys        : states, assemblies, orchestrations, system_orchestration
--     ADDED key           : safety_gates  (from spec_projects.safety_gates)
--     RENAMED key         : assemblies    → equipment_modules
--                           (keyed by equipment_module_id, not assembly_id)
--     em_states / em_transitions included automatically via to_jsonb(f.*)
--       because migration 20260618032808 added those columns to
--       fds_operation_sessions — no explicit SELECT column list change needed.
--
-- BASED ON
--   Migration 20260617001222_isa88_column_rename.sql (most recent prior
--   definition of _build_contract_snapshot, which already read confirmed_units
--   but still used old table names; 091 had not landed on the remote DB).
--   This rewrite adopts the post-091 table names and the new contract shape.
-- =============================================================================

-- ============================================================
-- _build_contract_snapshot — hybrid state model, schema_version 3
-- ============================================================

CREATE OR REPLACE FUNCTION _build_contract_snapshot(p_spec_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project          jsonb;
  v_hierarchy        jsonb;   -- raw confirmed_units array from spec_projects
  v_alarm_tiers      jsonb;
  v_sections         jsonb;
  v_equipment_modules jsonb;  -- fds_operation_sessions rows keyed by equipment_module_id
  v_safety_gates     jsonb;   -- from spec_projects.safety_gates
  v_alarms           jsonb;
BEGIN
  -- Project header + hierarchy + tiers + safety gates.
  -- NOTE: confirmed_units was renamed from confirmed_subsystems in migration
  --       20260617001222. migration 091 renamed the column from the old
  --       assembly-session era; this body targets the post-rename state.
  -- NOTE: confirmed_states (the old global operating-states array) is no longer
  --       part of the contract (schema_version 3 moved states per-EM). It is
  --       read here only as an existence check; it is NOT emitted in the output.
  --       safety_gates was added by migration 20260618032808.
  SELECT to_jsonb(sp.*),
         COALESCE(sp.confirmed_units, '[]'::jsonb),
         COALESCE(sp.alarm_tiers,     '[]'::jsonb),
         COALESCE(sp.safety_gates,    '[]'::jsonb)
    INTO v_project, v_hierarchy, v_alarm_tiers, v_safety_gates
    FROM spec_projects sp
   WHERE sp.id = p_spec_project_id;

  IF v_project IS NULL THEN
    RAISE EXCEPTION 'spec_projects row % not found', p_spec_project_id;
  END IF;

  -- Sections grouped by section_type → array of rows (unchanged from prior body)
  SELECT COALESCE(jsonb_object_agg(section_type, rows), '{}'::jsonb)
    INTO v_sections
    FROM (
      SELECT section_type,
             jsonb_agg(to_jsonb(s.*)) AS rows
        FROM spec_sections s
       WHERE s.spec_project_id = p_spec_project_id
       GROUP BY section_type
    ) t;

  -- fds_operation_sessions rows keyed by equipment_module_id.
  -- to_jsonb(f.*) picks up ALL columns including em_states and em_transitions
  -- (both added by migration 20260618032808 with NOT NULL DEFAULT '[]' — safe
  -- on existing rows). No explicit column enumeration is needed.
  SELECT COALESCE(jsonb_object_agg(equipment_module_id, row_json), '{}'::jsonb)
    INTO v_equipment_modules
    FROM (
      SELECT f.equipment_module_id::text AS equipment_module_id,
             to_jsonb(f.*)               AS row_json
        FROM fds_operation_sessions f
       WHERE f.spec_project_id = p_spec_project_id
    ) t;

  -- Alarms as an array (unchanged from prior body)
  SELECT COALESCE(jsonb_agg(to_jsonb(a.*)), '[]'::jsonb)
    INTO v_alarms
    FROM spec_alarms a
   WHERE a.spec_project_id = p_spec_project_id;

  -- Build and return the schema_version 3 contract snapshot.
  -- Keys removed vs prior version:
  --   'states'             — global operating states (moved per-EM in hybrid model)
  --   'assemblies'         — renamed to 'equipment_modules'
  --   'orchestrations'     — fds_unit_procedures dropped
  --   'system_orchestration'— fds_system_procedures dropped
  -- Keys added vs prior version:
  --   'safety_gates'       — machine-level safety gates (spec_projects column)
  -- Key changed vs prior version:
  --   hierarchy key 'subsystems' → 'units'  (matches HierarchySchema.units)
  --   schema_version 2            → 3        (matches SpecContractV2Schema literal)
  RETURN jsonb_build_object(
    'schema_version',    3,
    'project',           v_project,
    'hierarchy',         jsonb_build_object('units', v_hierarchy),
    'alarm_tiers',       v_alarm_tiers,
    'equipment_modules', v_equipment_modules,
    'safety_gates',      v_safety_gates,
    'alarms',            v_alarms,
    'sections',          v_sections
  );
END;
$$;

COMMENT ON FUNCTION _build_contract_snapshot(uuid)
  IS 'Internal: assembles a SpecContractV2 (schema_version 3) snapshot from live tables. '
     'Updated in migration 20260618032809 (hybrid-EM-state-model) to: '
     'use schema_version 3; emit hierarchy.units (not subsystems); '
     'include safety_gates and equipment_modules (with em_states/em_transitions via to_jsonb); '
     'drop states, orchestrations, and system_orchestration keys. '
     'References post-091 table names (fds_operation_sessions) and '
     'post-20260617001222 column names (confirmed_units).';

GRANT EXECUTE ON FUNCTION _build_contract_snapshot(uuid) TO authenticated;

-- ============================================================
-- DROP obsolete orchestration tables
--
-- fds_unit_procedures    = post-091 name of fds_subsystem_orchestrations
-- fds_system_procedures  = post-091 name of fds_system_orchestrations
--
-- CAUTION: On a database where migration 091 was NOT applied, these tables
-- will still exist under their OLD names:
--   fds_subsystem_orchestrations  (not dropped here — adapt the script)
--   fds_system_orchestrations     (not dropped here — adapt the script)
-- The IF EXISTS guard makes this safe to run against either state, but the
-- old-named tables will be LEFT INTACT on an un-reconciled DB — the user
-- must drop them manually or via a follow-up migration.
-- ============================================================

DROP TABLE IF EXISTS public.fds_unit_procedures   CASCADE;
DROP TABLE IF EXISTS public.fds_system_procedures  CASCADE;
