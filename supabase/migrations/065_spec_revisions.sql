-- Spec Contract V2: revision history + immutability (Wave 1)
-- Adds spec_project_revisions with immutability guard, wires revision
-- pointers on spec_projects, and binds forge_sessions to a revision.

-- ============================================================
-- spec_project_revisions — immutable revision snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS spec_project_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id uuid NOT NULL REFERENCES spec_projects(id) ON DELETE RESTRICT,

  revision_number int NOT NULL,
  display_label text NOT NULL,  -- e.g. "01A", "01B", "02A"

  status text NOT NULL CHECK (status IN ('draft','submitted','approved','revised')),
  source text NOT NULL CHECK (source IN ('authored','markup','foreign_ingest')),

  parent_revision_id uuid REFERENCES spec_project_revisions(id),

  -- Full SpecContractV2 tree. May be null when offloaded to storage.
  snapshot_json jsonb,
  snapshot_storage_path text,

  -- Rendered DOCX location (Supabase Storage path)
  docx_storage_path text,

  notes text,

  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users,

  UNIQUE (spec_project_id, revision_number)
);

-- Enforce at-most-one draft per project
CREATE UNIQUE INDEX IF NOT EXISTS uq_spec_revision_draft
  ON spec_project_revisions(spec_project_id)
  WHERE status = 'draft';

-- ============================================================
-- Immutability trigger
-- ============================================================
CREATE OR REPLACE FUNCTION spec_project_revisions_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
  -- Drafts are fully mutable
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Post-draft: only allow narrow transitions on status and limited fields
  -- Allowed status transitions:
  --   submitted -> approved
  --   submitted -> revised
  IF OLD.status <> NEW.status THEN
    IF NOT (
      (OLD.status = 'submitted' AND NEW.status IN ('approved','revised'))
    ) THEN
      RAISE EXCEPTION 'Illegal status transition on spec_project_revisions: % -> %',
        OLD.status, NEW.status;
    END IF;
  END IF;

  -- Block changes to any field other than status, approved_at, approved_by, notes
  IF  OLD.spec_project_id       IS DISTINCT FROM NEW.spec_project_id
   OR OLD.revision_number       IS DISTINCT FROM NEW.revision_number
   OR OLD.display_label         IS DISTINCT FROM NEW.display_label
   OR OLD.source                IS DISTINCT FROM NEW.source
   OR OLD.parent_revision_id    IS DISTINCT FROM NEW.parent_revision_id
   OR OLD.snapshot_json         IS DISTINCT FROM NEW.snapshot_json
   OR OLD.snapshot_storage_path IS DISTINCT FROM NEW.snapshot_storage_path
   OR OLD.docx_storage_path     IS DISTINCT FROM NEW.docx_storage_path
   OR OLD.created_by            IS DISTINCT FROM NEW.created_by
   OR OLD.created_at            IS DISTINCT FROM NEW.created_at
   OR OLD.submitted_at          IS DISTINCT FROM NEW.submitted_at
  THEN
    RAISE EXCEPTION 'spec_project_revisions row is immutable after draft (only status, approved_at, approved_by, notes may change)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER spec_project_revisions_immutable_guard
  BEFORE UPDATE ON spec_project_revisions
  FOR EACH ROW EXECUTE FUNCTION spec_project_revisions_immutable_guard();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE spec_project_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own spec_project_revisions"
  ON spec_project_revisions FOR SELECT
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users insert own spec_project_revisions"
  ON spec_project_revisions FOR INSERT
  WITH CHECK (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE POLICY "Users update own spec_project_revisions"
  ON spec_project_revisions FOR UPDATE
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  )
  WITH CHECK (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

-- Note: non-draft row immutability is enforced by the BEFORE UPDATE trigger
-- `spec_project_revisions_immutable_guard` above. A second RLS policy was
-- considered but would OR-combine with the owner policy (both permissive),
-- so it would not actually block anything. The trigger is authoritative.

CREATE POLICY "Users delete own spec_project_revisions"
  ON spec_project_revisions FOR DELETE
  USING (
    spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

-- ============================================================
-- Wire FK pointers on spec_projects (forward-declared in 064)
-- ============================================================
ALTER TABLE spec_projects
  ADD CONSTRAINT spec_projects_current_draft_revision_fk
  FOREIGN KEY (current_draft_revision_id)
  REFERENCES spec_project_revisions(id)
  ON DELETE SET NULL;

ALTER TABLE spec_projects
  ADD CONSTRAINT spec_projects_latest_approved_revision_fk
  FOREIGN KEY (latest_approved_revision_id)
  REFERENCES spec_project_revisions(id)
  ON DELETE SET NULL;

-- ============================================================
-- forge_sessions → spec_revision_id (pinned on session open)
-- ============================================================
-- forge_sessions is known to exist (migration 025); add the column.
ALTER TABLE forge_sessions
  ADD COLUMN IF NOT EXISTS spec_revision_id uuid REFERENCES spec_project_revisions(id);

COMMENT ON COLUMN forge_sessions.spec_revision_id IS 'Spec revision pinned when the forge session was opened. Nullable for legacy sessions.';
