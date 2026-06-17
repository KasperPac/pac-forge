-- Bind customer-spec sections to a specific equipment module so the FDS
-- co-author can inject per-EM requirements by id (register-aware ingest),
-- instead of brittle name-matching.

ALTER TABLE spec_source_sections
  ADD COLUMN IF NOT EXISTS equipment_module_id uuid;

CREATE INDEX IF NOT EXISTS idx_spec_source_sections_em
  ON spec_source_sections (equipment_module_id);
