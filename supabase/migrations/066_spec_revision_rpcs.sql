-- Spec Contract V2: revision RPCs (Wave 4)
--
-- Exposes the revision state machine as PL/pgSQL functions so the frontend
-- can use a single, auditable entry point per transition. Authorization is
-- enforced via `spec_projects.created_by = auth.uid()`. Post-draft
-- immutability is enforced by the BEFORE UPDATE trigger defined in 065.

-- ============================================================
-- Snapshot builder (internal)
-- ============================================================
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
BEGIN
  -- Project header + raw hierarchy/states/tiers
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

  -- Sections grouped by section_type → array of rows
  SELECT COALESCE(jsonb_object_agg(section_type, rows), '{}'::jsonb)
    INTO v_sections
    FROM (
      SELECT section_type,
             jsonb_agg(to_jsonb(s.*)) AS rows
        FROM spec_sections s
       WHERE s.spec_project_id = p_spec_project_id
       GROUP BY section_type
    ) t;

  -- fds_assembly_sessions keyed by assembly_id
  SELECT COALESCE(jsonb_object_agg(assembly_id, row_json), '{}'::jsonb)
    INTO v_assemblies
    FROM (
      SELECT assembly_id::text AS assembly_id, to_jsonb(f.*) AS row_json
        FROM fds_assembly_sessions f
       WHERE f.spec_project_id = p_spec_project_id
    ) t;

  -- fds_subsystem_orchestrations keyed by subsystem_id
  SELECT COALESCE(jsonb_object_agg(subsystem_id, row_json), '{}'::jsonb)
    INTO v_orchestrations
    FROM (
      SELECT subsystem_id::text AS subsystem_id, to_jsonb(o.*) AS row_json
        FROM fds_subsystem_orchestrations o
       WHERE o.spec_project_id = p_spec_project_id
    ) t;

  -- Alarms as an array
  SELECT COALESCE(jsonb_agg(to_jsonb(a.*)), '[]'::jsonb)
    INTO v_alarms
    FROM spec_alarms a
   WHERE a.spec_project_id = p_spec_project_id;

  RETURN jsonb_build_object(
    'schema_version', 2,
    'project',       v_project,
    'hierarchy',     jsonb_build_object('subsystems', v_hierarchy),
    'states',        v_states,
    'alarm_tiers',   v_alarm_tiers,
    'sections',      v_sections,
    'assemblies',    v_assemblies,
    'orchestrations',v_orchestrations,
    'alarms',        v_alarms
  );
END;
$$;

COMMENT ON FUNCTION _build_contract_snapshot(uuid)
  IS 'Internal: assembles a minimal SpecContractV2-shaped snapshot from live tables.';

-- ============================================================
-- Label helper — int revision_number + suffix index → "01A" style
-- ============================================================
CREATE OR REPLACE FUNCTION _format_revision_label(p_number int, p_suffix_index int)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_suffix text;
  v_idx int := p_suffix_index;
BEGIN
  IF v_idx < 0 THEN v_idx := 0; END IF;
  -- base-26 rollover: 0→A, 25→Z, 26→AA, ...
  IF v_idx < 26 THEN
    v_suffix := chr(65 + v_idx);
  ELSE
    v_suffix := chr(65 + (v_idx / 26) - 1) || chr(65 + (v_idx % 26));
  END IF;
  RETURN lpad(p_number::text, 2, '0') || v_suffix;
END;
$$;

COMMENT ON FUNCTION _format_revision_label(int, int)
  IS 'Internal: formats a revision number + suffix index into a label like "01A", "02C", "27AA".';

-- ============================================================
-- create_draft_from_current
-- ============================================================
CREATE OR REPLACE FUNCTION create_draft_from_current(p_spec_project_id uuid)
RETURNS spec_project_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent uuid;
  v_existing_draft uuid;
  v_snapshot jsonb;
  v_row spec_project_revisions;
BEGIN
  -- Auth: caller must own the project
  IF NOT EXISTS (
    SELECT 1 FROM spec_projects
     WHERE id = p_spec_project_id
       AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized for spec_project %', p_spec_project_id;
  END IF;

  SELECT id INTO v_existing_draft
    FROM spec_project_revisions
   WHERE spec_project_id = p_spec_project_id
     AND status = 'draft';
  IF v_existing_draft IS NOT NULL THEN
    RAISE EXCEPTION 'draft revision already exists for spec_project %', p_spec_project_id
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT latest_approved_revision_id INTO v_parent
    FROM spec_projects
   WHERE id = p_spec_project_id;

  v_snapshot := _build_contract_snapshot(p_spec_project_id);

  INSERT INTO spec_project_revisions (
    spec_project_id, revision_number, display_label, status, source,
    parent_revision_id, snapshot_json, created_by
  )
  VALUES (
    p_spec_project_id, 0, 'draft', 'draft', 'authored',
    v_parent, v_snapshot, auth.uid()
  )
  RETURNING * INTO v_row;

  UPDATE spec_projects
     SET current_draft_revision_id = v_row.id
   WHERE id = p_spec_project_id;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION create_draft_from_current(uuid)
  IS 'Creates a draft revision from live tables. Fails if a draft already exists.';

-- ============================================================
-- create_draft_from_ingest
-- ============================================================
CREATE OR REPLACE FUNCTION create_draft_from_ingest(
  p_spec_project_id uuid,
  p_ingest_tree jsonb,
  p_source text,
  p_parent_revision_id uuid DEFAULT NULL
)
RETURNS spec_project_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_draft uuid;
  v_row spec_project_revisions;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM spec_projects
     WHERE id = p_spec_project_id
       AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized for spec_project %', p_spec_project_id;
  END IF;

  IF p_source NOT IN ('markup', 'foreign_ingest') THEN
    RAISE EXCEPTION 'create_draft_from_ingest: p_source must be markup or foreign_ingest, got %', p_source;
  END IF;

  SELECT id INTO v_existing_draft
    FROM spec_project_revisions
   WHERE spec_project_id = p_spec_project_id
     AND status = 'draft';
  IF v_existing_draft IS NOT NULL THEN
    RAISE EXCEPTION 'draft revision already exists for spec_project %', p_spec_project_id
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO spec_project_revisions (
    spec_project_id, revision_number, display_label, status, source,
    parent_revision_id, snapshot_json, created_by
  )
  VALUES (
    p_spec_project_id, 0, 'draft', 'draft', p_source,
    p_parent_revision_id, p_ingest_tree, auth.uid()
  )
  RETURNING * INTO v_row;

  UPDATE spec_projects
     SET current_draft_revision_id = v_row.id
   WHERE id = p_spec_project_id;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION create_draft_from_ingest(uuid, jsonb, text, uuid)
  IS 'Creates a draft revision from an ingested tree (markup or foreign_ingest source).';

-- ============================================================
-- submit_draft
-- ============================================================
CREATE OR REPLACE FUNCTION submit_draft(p_revision_id uuid, p_notes text DEFAULT NULL)
RETURNS spec_project_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rev spec_project_revisions;
  v_parent spec_project_revisions;
  v_next_number int;
  v_suffix_index int := 0;
  v_label text;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_rev FROM spec_project_revisions WHERE id = p_revision_id;
  IF v_rev.id IS NULL THEN
    RAISE EXCEPTION 'revision % not found', p_revision_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM spec_projects
     WHERE id = v_rev.spec_project_id
       AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized for spec_project %', v_rev.spec_project_id;
  END IF;

  IF v_rev.status <> 'draft' THEN
    RAISE EXCEPTION 'submit_draft: revision status must be draft, got %', v_rev.status;
  END IF;

  -- Determine the revision_number + label. If branching from an existing
  -- revision, same revision_number + next letter; else new revision_number.
  IF v_rev.parent_revision_id IS NOT NULL THEN
    SELECT * INTO v_parent
      FROM spec_project_revisions
     WHERE id = v_rev.parent_revision_id;
  END IF;

  IF v_parent.id IS NOT NULL AND v_parent.revision_number > 0 THEN
    -- Branching: share parent's revision_number; increment suffix
    v_next_number := v_parent.revision_number;
    SELECT COUNT(*) INTO v_suffix_index
      FROM spec_project_revisions
     WHERE spec_project_id = v_rev.spec_project_id
       AND revision_number = v_next_number
       AND status <> 'draft';
    -- v_suffix_index is the count of existing same-number revisions; that IS
    -- the next index (0-based).
  ELSE
    SELECT COALESCE(MAX(revision_number), 0) + 1
      INTO v_next_number
      FROM spec_project_revisions
     WHERE spec_project_id = v_rev.spec_project_id
       AND status <> 'draft';
    v_suffix_index := 0;
  END IF;

  v_label := _format_revision_label(v_next_number, v_suffix_index);

  -- Rebuild snapshot authoritatively from live tables
  v_snapshot := _build_contract_snapshot(v_rev.spec_project_id);

  -- The immutability trigger blocks drafts only, so this UPDATE will go
  -- through; however the trigger's allowed-fields check runs on
  -- non-draft→non-draft transitions. draft→submitted is permitted here.
  UPDATE spec_project_revisions
     SET revision_number = v_next_number,
         display_label   = v_label,
         status          = 'submitted',
         submitted_at    = now(),
         notes           = COALESCE(p_notes, notes),
         snapshot_json   = v_snapshot
   WHERE id = p_revision_id
   RETURNING * INTO v_rev;

  UPDATE spec_projects
     SET current_draft_revision_id = NULL
   WHERE id = v_rev.spec_project_id;

  RETURN v_rev;
END;
$$;

COMMENT ON FUNCTION submit_draft(uuid, text)
  IS 'Promotes a draft to submitted, assigning revision_number + letter-suffix display_label.';

-- ============================================================
-- approve_revision
-- ============================================================
CREATE OR REPLACE FUNCTION approve_revision(p_revision_id uuid)
RETURNS spec_project_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rev spec_project_revisions;
BEGIN
  SELECT * INTO v_rev FROM spec_project_revisions WHERE id = p_revision_id;
  IF v_rev.id IS NULL THEN
    RAISE EXCEPTION 'revision % not found', p_revision_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM spec_projects
     WHERE id = v_rev.spec_project_id
       AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized for spec_project %', v_rev.spec_project_id;
  END IF;

  IF v_rev.status <> 'submitted' THEN
    RAISE EXCEPTION 'approve_revision: revision status must be submitted, got %', v_rev.status;
  END IF;

  UPDATE spec_project_revisions
     SET status = 'approved',
         approved_at = now(),
         approved_by = auth.uid()
   WHERE id = p_revision_id
   RETURNING * INTO v_rev;

  UPDATE spec_projects
     SET latest_approved_revision_id = p_revision_id
   WHERE id = v_rev.spec_project_id;

  RETURN v_rev;
END;
$$;

COMMENT ON FUNCTION approve_revision(uuid)
  IS 'Approves a submitted revision and sets latest_approved_revision_id on the spec project.';

-- ============================================================
-- reject_revision
-- ============================================================
CREATE OR REPLACE FUNCTION reject_revision(p_revision_id uuid, p_notes text)
RETURNS spec_project_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rev spec_project_revisions;
  v_merged_notes text;
BEGIN
  SELECT * INTO v_rev FROM spec_project_revisions WHERE id = p_revision_id;
  IF v_rev.id IS NULL THEN
    RAISE EXCEPTION 'revision % not found', p_revision_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM spec_projects
     WHERE id = v_rev.spec_project_id
       AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized for spec_project %', v_rev.spec_project_id;
  END IF;

  IF v_rev.status <> 'submitted' THEN
    RAISE EXCEPTION 'reject_revision: revision status must be submitted, got %', v_rev.status;
  END IF;

  IF v_rev.notes IS NULL OR length(v_rev.notes) = 0 THEN
    v_merged_notes := p_notes;
  ELSE
    v_merged_notes := v_rev.notes || E'\n' || COALESCE(p_notes, '');
  END IF;

  UPDATE spec_project_revisions
     SET status = 'revised',
         notes  = v_merged_notes
   WHERE id = p_revision_id
   RETURNING * INTO v_rev;

  RETURN v_rev;
END;
$$;

COMMENT ON FUNCTION reject_revision(uuid, text)
  IS 'Rejects a submitted revision, moving it to revised and appending notes.';

-- ============================================================
-- revert_to_revision
-- ============================================================
-- NOTE (pass 1 limitation): reverts rebuild spec_projects.confirmed_* from
-- the snapshot but do NOT rewrite spec_sections / fds_assembly_sessions /
-- fds_subsystem_orchestrations. Those tables are left untouched and will be
-- overwritten by the engineer's next save. Full restore lands in a later pass.
CREATE OR REPLACE FUNCTION revert_to_revision(p_target_revision_id uuid)
RETURNS spec_project_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
     SET confirmed_subsystems = v_subsystems,
         confirmed_states     = v_states,
         alarm_tiers          = v_tiers
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
$$;

COMMENT ON FUNCTION revert_to_revision(uuid)
  IS 'Creates a draft branched from an approved/revised revision and restores spec_projects JSONB columns. Does NOT restore sections/assembly sessions/orchestrations (pass 1 limitation).';

-- ============================================================
-- ingest_markup_draft — deferred
-- ============================================================
CREATE OR REPLACE FUNCTION ingest_markup_draft(
  p_spec_project_id uuid,
  p_docx_storage_path text
)
RETURNS spec_project_revisions
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'markup re-ingest deferred'
    USING HINT = 'Wave 4: sentinel-based markup re-ingest is not yet implemented; upload handler creates a fresh draft via create_draft_from_ingest instead.';
  -- Unreachable, but PL/pgSQL requires a return path.
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION ingest_markup_draft(uuid, text)
  IS 'Stub: markup DOCX re-ingest (diff-merge) deferred. Raises always.';

-- ============================================================
-- Grants
-- ============================================================
GRANT EXECUTE ON FUNCTION _build_contract_snapshot(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION _format_revision_label(int, int)     TO authenticated;
GRANT EXECUTE ON FUNCTION create_draft_from_current(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION create_draft_from_ingest(uuid, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_draft(uuid, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION approve_revision(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION reject_revision(uuid, text)          TO authenticated;
GRANT EXECUTE ON FUNCTION revert_to_revision(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION ingest_markup_draft(uuid, text)      TO authenticated;
