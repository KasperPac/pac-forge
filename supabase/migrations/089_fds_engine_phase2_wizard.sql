-- supabase/migrations/089_fds_engine_phase2_wizard.sql
-- FDS Engine Phase 2 — wizard scratch column on spec_projects + telemetry table
-- for completed migrations. No data rewrite at deploy time.

BEGIN;

-- Per-project wizard scratch state. NULL = no wizard run in flight (either
-- never started, or successfully confirmed and cleared).
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS migration_draft jsonb;

COMMENT ON COLUMN spec_projects.migration_draft IS
  'MigrationDraft: per-project wizard scratch state. Cleared (set NULL) on successful Confirm. See src/lib/spec-builder/migrate/types.ts for the TypeScript shape.';

-- Telemetry — one row per successful Confirm. Read by future dashboards.
-- Gates Release N+2 (legacy field drop) per parent design §6.
CREATE TABLE IF NOT EXISTS fds_migration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_project_id uuid NOT NULL REFERENCES spec_projects(id) ON DELETE CASCADE,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  modes_count int NOT NULL,
  custom_states_count int NOT NULL,
  interlocks_classified_count int NOT NULL,
  interlocks_overridden_count int NOT NULL
);

CREATE INDEX IF NOT EXISTS fds_migration_events_spec_project_id_idx
  ON fds_migration_events (spec_project_id);
CREATE INDEX IF NOT EXISTS fds_migration_events_confirmed_at_idx
  ON fds_migration_events (confirmed_at DESC);

COMMENT ON TABLE fds_migration_events IS
  'One row per successful FDS engine V2 migration confirm. interlocks_overridden_count is a proxy for AI classifier miss rate.';

COMMIT;
