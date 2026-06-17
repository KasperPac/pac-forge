-- 094_spec_source_sections.sql
-- Stores the customer .docx split into sections (Gap 2), and adds provenance
-- to instrument_registers so synthesized registers are distinguishable from
-- uploaded ones (Gap 3).

CREATE TABLE IF NOT EXISTS spec_source_sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id uuid NOT NULL REFERENCES spec_projects(id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  heading         text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',
  order_index     int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spec_source_sections_project
  ON spec_source_sections (spec_project_id, order_index);

ALTER TABLE spec_source_sections ENABLE ROW LEVEL SECURITY;

-- Owner access mirrors instrument_registers: the owning spec_projects row's creator.
CREATE POLICY "Users manage own spec_source_sections" ON spec_source_sections
  FOR ALL
  USING (spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid()))
  WITH CHECK (spec_project_id IN (SELECT id FROM spec_projects WHERE created_by = auth.uid()));

-- Provenance for synthesized vs uploaded registers (Workstream C).
ALTER TABLE instrument_registers
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload';
