-- ============================================================
-- 085_drop_projects_job_code.sql
-- Drop the redundant projects.job_code column. The Pac-Quote module
-- used this as the quote-number prefix, but the projects table
-- already had a project_number column from the Pac-ST/Forge era.
-- The two were duplicates; consolidate on project_number.
-- ============================================================

ALTER TABLE projects DROP COLUMN IF EXISTS job_code;
