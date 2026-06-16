-- ISA-88 terminology alignment.
--
-- Renames tables, columns, indexes, constraints, and RPC functions to use
-- ISA-88 / S88 standard vocabulary:
--
--   fds_assembly_sessions      → fds_operation_sessions
--   fds_subsystem_orchestrations → fds_unit_procedures
--   fds_system_orchestrations  → fds_system_procedures
--
--   subsystem_id / subsystem_name → unit_id / unit_name
--   assembly_id  / assembly_name  → equipment_module_id / equipment_module_name
--   device_id    / device_name    → control_module_id / control_module_name
--   device_class                  → control_module_class
--   is_assembly  (fb_templates)   → is_equipment_module
--
-- Also adds spec_projects.process_model JSONB column (nullable).
--
-- All changes are structural renames only — no data is rewritten.
-- The _build_contract_snapshot RPC is recreated at the end to reference the
-- new table and column names.

-- ============================================================
-- 1. COLUMN RENAMES — fds_assembly_sessions
--    (must happen before TABLE rename so we can still use the
--     old table name in these statements)
-- ============================================================

ALTER TABLE fds_assembly_sessions
  RENAME COLUMN subsystem_id TO unit_id;

ALTER TABLE fds_assembly_sessions
  RENAME COLUMN assembly_id TO equipment_module_id;

-- ============================================================
-- 2. COLUMN RENAMES — fds_subsystem_orchestrations
-- ============================================================

ALTER TABLE fds_subsystem_orchestrations
  RENAME COLUMN subsystem_id TO unit_id;

-- ============================================================
-- 3. COLUMN RENAMES — spec_sections
--    (subsystem_id added in 054; assembly_id added in 064)
-- ============================================================

ALTER TABLE spec_sections
  RENAME COLUMN subsystem_id TO unit_id;

ALTER TABLE spec_sections
  RENAME COLUMN assembly_id TO equipment_module_id;

-- ============================================================
-- 4. COLUMN RENAMES — spec_alarms
--    (device_id, assembly_id, subsystem_id added in 064)
-- ============================================================

ALTER TABLE spec_alarms
  RENAME COLUMN subsystem_id TO unit_id;

ALTER TABLE spec_alarms
  RENAME COLUMN assembly_id TO equipment_module_id;

ALTER TABLE spec_alarms
  RENAME COLUMN device_id TO control_module_id;

-- ============================================================
-- 5. COLUMN RENAME — fb_templates
--    (is_assembly added in 058)
-- ============================================================

ALTER TABLE fb_templates
  RENAME COLUMN is_assembly TO is_equipment_module;

-- ============================================================
-- 6. NEW COLUMN — spec_projects.process_model
-- ============================================================

ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS process_model jsonb DEFAULT NULL;

COMMENT ON COLUMN spec_projects.process_model IS
  'ISA-88 ProcessModel: top-level structured representation of the process cell, unit procedures, operations, and phases. NULL on projects that have not yet been modelled.';

-- ============================================================
-- 7. DROP AFFECTED INDEXES
--    (indexes that reference old column names must be dropped
--     before or after rename — either is valid in Postgres since
--     column renames update index definitions in place, BUT
--     named indexes that embed the old column name in their
--     identifier are confusing, so we drop and recreate them
--     with ISA-88 names)
-- ============================================================

-- idx_fds_sessions_project was on fds_assembly_sessions(spec_project_id, subsystem_id)
DROP INDEX IF EXISTS idx_fds_sessions_project;

-- idx_spec_sections_assy_state was on spec_sections(spec_project_id, assembly_id, state_id)
DROP INDEX IF EXISTS idx_spec_sections_assy_state;

-- idx_spec_alarms_device was on spec_alarms(spec_project_id, device_id)
DROP INDEX IF EXISTS idx_spec_alarms_device;

-- ============================================================
-- 8. RENAME NAMED CONSTRAINTS added by migration 090
--    Postgres renames constraint column references automatically
--    when columns are renamed, but the constraint identifiers
--    themselves embed old names and must be renamed explicitly.
-- ============================================================

ALTER TABLE fds_assembly_sessions
  RENAME CONSTRAINT fds_assembly_sessions_project_assembly_key
  TO fds_operation_sessions_project_equipment_module_key;

ALTER TABLE fds_subsystem_orchestrations
  RENAME CONSTRAINT fds_subsystem_orchestrations_project_subsystem_key
  TO fds_unit_procedures_project_unit_key;

-- ============================================================
-- 9. TABLE RENAMES
-- ============================================================

ALTER TABLE fds_assembly_sessions
  RENAME TO fds_operation_sessions;

ALTER TABLE fds_subsystem_orchestrations
  RENAME TO fds_unit_procedures;

ALTER TABLE fds_system_orchestrations
  RENAME TO fds_system_procedures;

-- ============================================================
-- 10. RECREATE INDEXES with ISA-88 names
-- ============================================================

-- Replaces idx_fds_sessions_project
CREATE INDEX idx_fds_operation_sessions_project
  ON fds_operation_sessions(spec_project_id, unit_id);

-- Replaces idx_spec_sections_assy_state
CREATE INDEX idx_spec_sections_equip_module_state
  ON spec_sections(spec_project_id, equipment_module_id, state_id)
  WHERE section_type = 'functional_description';

-- Replaces idx_spec_alarms_device
CREATE INDEX idx_spec_alarms_control_module
  ON spec_alarms(spec_project_id, control_module_id);

-- ============================================================
-- 11. RECREATE RLS POLICIES that embed table names in their label
--
--     Postgres does NOT automatically rename policies when a table
--     is renamed, but the policy definitions themselves (the USING /
--     WITH CHECK expressions) continue to work because they reference
--     column names (which are already renamed above) rather than
--     the table name. We drop the stale-named policies and recreate
--     them under ISA-88 names for clarity. The underlying security
--     logic is unchanged.
-- ============================================================

-- --- fds_operation_sessions (was fds_assembly_sessions) ---

DROP POLICY IF EXISTS "Users manage own fds_assembly_sessions" ON fds_operation_sessions;

CREATE POLICY "Users manage own fds_operation_sessions"
  ON fds_operation_sessions FOR ALL
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

-- --- fds_unit_procedures (was fds_subsystem_orchestrations) ---

DROP POLICY IF EXISTS "Users manage own fds_subsystem_orchestrations" ON fds_unit_procedures;

CREATE POLICY "Users manage own fds_unit_procedures"
  ON fds_unit_procedures FOR ALL
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

-- --- fds_system_procedures (was fds_system_orchestrations) ---
-- 067 created 4 per-operation policies; replace with equivalent named ones.

DROP POLICY IF EXISTS "Users select own fds_system_orchestrations" ON fds_system_procedures;
DROP POLICY IF EXISTS "Users insert own fds_system_orchestrations" ON fds_system_procedures;
DROP POLICY IF EXISTS "Users update own fds_system_orchestrations" ON fds_system_procedures;
DROP POLICY IF EXISTS "Users delete own fds_system_orchestrations" ON fds_system_procedures;

CREATE POLICY "Users select own fds_system_procedures"
  ON fds_system_procedures FOR SELECT
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users insert own fds_system_procedures"
  ON fds_system_procedures FOR INSERT
  WITH CHECK (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users update own fds_system_procedures"
  ON fds_system_procedures FOR UPDATE
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  )
  WITH CHECK (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users delete own fds_system_procedures"
  ON fds_system_procedures FOR DELETE
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

-- ============================================================
-- 12. RECREATE _build_contract_snapshot RPC
--
--     This function (first defined in 066, extended in 067) references
--     old table names and old column names. We replace it with an
--     identical body that uses ISA-88 names throughout.
--     The public signature (arg type + return type) is unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION _build_contract_snapshot(p_spec_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project          jsonb;
  v_hierarchy        jsonb;
  v_states           jsonb;
  v_alarm_tiers      jsonb;
  v_sections         jsonb;
  v_operations       jsonb;   -- was v_assemblies
  v_unit_procedures  jsonb;   -- was v_orchestrations
  v_alarms           jsonb;
  v_system_proc      jsonb;   -- was v_system_orch
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

  -- fds_operation_sessions keyed by equipment_module_id
  SELECT COALESCE(jsonb_object_agg(equipment_module_id, row_json), '{}'::jsonb)
    INTO v_operations
    FROM (
      SELECT equipment_module_id::text AS equipment_module_id,
             to_jsonb(f.*) AS row_json
        FROM fds_operation_sessions f
       WHERE f.spec_project_id = p_spec_project_id
    ) t;

  -- fds_unit_procedures keyed by unit_id
  SELECT COALESCE(jsonb_object_agg(unit_id, row_json), '{}'::jsonb)
    INTO v_unit_procedures
    FROM (
      SELECT unit_id::text AS unit_id, to_jsonb(o.*) AS row_json
        FROM fds_unit_procedures o
       WHERE o.spec_project_id = p_spec_project_id
    ) t;

  SELECT to_jsonb(sp.*)
    INTO v_system_proc
    FROM fds_system_procedures sp
   WHERE sp.spec_project_id = p_spec_project_id
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(a.*)), '[]'::jsonb)
    INTO v_alarms
    FROM spec_alarms a
   WHERE a.spec_project_id = p_spec_project_id;

  RETURN jsonb_build_object(
    'schema_version',       2,
    'project',              v_project,
    'hierarchy',            jsonb_build_object('subsystems', v_hierarchy),
    'states',               v_states,
    'alarm_tiers',          v_alarm_tiers,
    'sections',             v_sections,
    'assemblies',           v_operations,        -- key kept for snapshot contract compatibility
    'orchestrations',       v_unit_procedures,   -- key kept for snapshot contract compatibility
    'system_orchestration', v_system_proc,       -- key kept for snapshot contract compatibility
    'alarms',               v_alarms
  );
END;
$$;

COMMENT ON FUNCTION _build_contract_snapshot(uuid)
  IS 'Internal: assembles a SpecContractV2-shaped snapshot from live tables. Updated in migration 091 to use ISA-88 table/column names (fds_operation_sessions, fds_unit_procedures, fds_system_procedures). Snapshot JSON keys (assemblies, orchestrations, system_orchestration) are preserved for contract compatibility.';

GRANT EXECUTE ON FUNCTION _build_contract_snapshot(uuid) TO authenticated;
