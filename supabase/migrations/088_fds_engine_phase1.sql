-- supabase/migrations/088_fds_engine_phase1.sql
-- FDS Engine Phase 1 — add nullable columns for modes, configuration parameters,
-- project-level section overrides, and per-project confirmation status.
-- No data rewrite. Existing projects remain on legacy shape until the
-- per-project confirmation wizard (Phase 2) lands and writes the new shape.

BEGIN;

-- Modes axis (§3.1 of design doc). NULL = legacy project; will be populated
-- with [{mode_id:"auto", name:"Auto", is_default:true}] by the wizard.
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS confirmed_modes jsonb;

-- Configuration parameters (§3.4). NULL = legacy / no parameters.
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS configuration_parameters jsonb;

-- Project-level section overrides (§3.5). One JSONB keyed by ProjectSectionType.
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS section_overrides jsonb;

-- Per-project confirmation gate (§5). 'unconfirmed' (default) routes reads
-- through the legacy shim; 'confirmed' reads the new structured shape.
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS confirmation_status text
    NOT NULL DEFAULT 'unconfirmed'
    CHECK (confirmation_status IN ('unconfirmed', 'confirmed'));

COMMENT ON COLUMN spec_projects.confirmed_modes IS
  'OperatorMode[]: project-level operating modes (auto/manual/service/...). NULL on unconfirmed projects.';
COMMENT ON COLUMN spec_projects.configuration_parameters IS
  'ConfigParameter[]: discrete-enum project-level switches referenced via Expression.parameter_ref.';
COMMENT ON COLUMN spec_projects.section_overrides IS
  'Record<ProjectSectionType, ProjectSectionContent>: editable content for the six project-level section types.';
COMMENT ON COLUMN spec_projects.confirmation_status IS
  'Per-project migration gate: unconfirmed reads legacy shape via shim, confirmed reads new structured shape.';

COMMIT;
