-- Code Builder C3 — quality-gate state on artifacts + a per-FB version log.

-- 1. Persisted gate / review state on each artifact (survives reload).
ALTER TABLE code_builder_artifacts
  ADD COLUMN acknowledged_warnings JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN review_status TEXT CHECK (review_status IN ('pass', 'findings')),
  ADD COLUMN review_findings JSONB NOT NULL DEFAULT '[]';

-- 2. Per-FB version log: a snapshot of the EM artifact set (FB + UDT + Cmd DB
--    + Map FC) keyed by owner_id + layer. Restore is non-destructive (writes a
--    new row), so history is append-only.
CREATE TABLE code_builder_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE NOT NULL,
  revision INT NOT NULL,

  owner_id TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('device', 'em', 'unit', 'ob1')),

  -- payload: { "artifacts": [{ "artifact_name": "...", "content": "..." }, ...] }
  payload JSONB NOT NULL DEFAULT '{"artifacts":[]}',
  note TEXT NOT NULL DEFAULT '',
  author UUID,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE code_builder_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own code_builder_versions"
  ON code_builder_versions FOR ALL
  USING (
    spec_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  )
  WITH CHECK (
    spec_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE INDEX idx_code_builder_versions_owner
  ON code_builder_versions(spec_id, revision, owner_id, layer);
