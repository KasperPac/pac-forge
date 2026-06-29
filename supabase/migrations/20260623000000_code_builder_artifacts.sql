-- Code Builder (Phase 4) — persisted generated artifacts + reviewer edits/approvals.

CREATE TABLE code_builder_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_id UUID REFERENCES spec_projects(id) ON DELETE CASCADE NOT NULL,
  revision INT NOT NULL,

  artifact_name TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('device', 'em', 'unit', 'ob1')),
  owner_id TEXT,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  folder TEXT NOT NULL,
  dependencies JSONB NOT NULL DEFAULT '[]',

  generated_content TEXT NOT NULL,
  edited_content TEXT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (spec_id, revision, artifact_name)
);

ALTER TABLE code_builder_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own code_builder_artifacts"
  ON code_builder_artifacts FOR ALL
  USING (
    spec_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  )
  WITH CHECK (
    spec_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid())
  );

CREATE INDEX idx_code_builder_artifacts_spec_rev
  ON code_builder_artifacts(spec_id, revision);

CREATE TRIGGER set_code_builder_artifacts_updated_at
  BEFORE UPDATE ON code_builder_artifacts
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
