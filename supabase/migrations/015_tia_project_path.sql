-- ============================================================
-- 015: Add TIA project path to process builder sessions
-- ============================================================

ALTER TABLE process_builder_sessions
  ADD COLUMN IF NOT EXISTS tia_project_path text;
