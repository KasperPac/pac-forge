-- ============================================================
-- FDS Engine Phase 3 — unique constraints for writeSpecContract upserts
-- ============================================================
-- writeSpecContract (src/lib/spec-builder/contract.ts) upserts into
-- fds_assembly_sessions with `onConflict: "spec_project_id,assembly_id"`
-- and into fds_subsystem_orchestrations with
-- `onConflict: "spec_project_id,subsystem_id"`. Both upserts fail without
-- a matching unique constraint on those column tuples. The constraints
-- were missing from the original Phase 1 migration (061_fds_co_author);
-- this migration adds them.

ALTER TABLE fds_assembly_sessions
  ADD CONSTRAINT fds_assembly_sessions_project_assembly_key
  UNIQUE (spec_project_id, assembly_id);

ALTER TABLE fds_subsystem_orchestrations
  ADD CONSTRAINT fds_subsystem_orchestrations_project_subsystem_key
  UNIQUE (spec_project_id, subsystem_id);
