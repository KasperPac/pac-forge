-- Assembly FB Library — Phase 1 schema
-- Per Docs/ASSEMBLY_FB_LIBRARY_PLAN.md §4
--
-- Adds:
--   1. fb_templates.interface_contract jsonb (structured input/output/io_slot/process_state declarations)
--   2. fb_templates.deprecated boolean
--   3. fds_assembly_sessions: fb_template_id (FK), fb_template_version, instance_params, instance_overrides, process_intent
--
-- All new columns are nullable / default-empty so existing rows stay valid and the
-- Co-Author falls back to today's free-form authoring when interface_contract = {}.

-- ============================================================
-- 1. fb_templates: interface contract + deprecation flag
-- ============================================================

ALTER TABLE fb_templates
  ADD COLUMN IF NOT EXISTS interface_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS deprecated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fb_templates.interface_contract IS
  'Structured FbInterfaceContract per src/types/fb-interface-contract.ts: { inputs, outputs, io_slots, process_state_reads, process_state_writes }. Empty {} means contract not yet authored — Co-Author falls back to free-form authoring.';

COMMENT ON COLUMN fb_templates.deprecated IS
  'When true, new specs cannot bind to this template. Existing spec bindings keep working. UI surfaces deprecation banner in FB Library.';

-- ============================================================
-- 2. fds_assembly_sessions: per-assembly template binding + instance config + intent hook
-- ============================================================

ALTER TABLE fds_assembly_sessions
  ADD COLUMN IF NOT EXISTS fb_template_id uuid REFERENCES fb_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fb_template_version int,
  ADD COLUMN IF NOT EXISTS instance_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS instance_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS process_intent text;

COMMENT ON COLUMN fds_assembly_sessions.fb_template_id IS
  'Library template the assembly is bound to. NULL = unmatched assembly authored greenfield (legacy + Mode-D fallback).';

COMMENT ON COLUMN fds_assembly_sessions.fb_template_version IS
  'fb_templates.version pinned at the time of binding. Plan §3.5 — later library edits do not silently retrofit.';

COMMENT ON COLUMN fds_assembly_sessions.instance_params IS
  'Map of role-slot-name → register tag name (or named-expression). Drives the Co-Author template-backed wiring form. Shape: Record<string,string>.';

COMMENT ON COLUMN fds_assembly_sessions.instance_overrides IS
  'Optional per-instance parameter overrides (timeouts, ramp rates, setpoints). Shape: Record<string,unknown>.';

COMMENT ON COLUMN fds_assembly_sessions.process_intent IS
  'Plan §3.7 / PILOT-001-011 hook — 1-2 sentences answering "what is this assembly''s role in the overall process? Why does it exist?". DOCX exporter ignores in v1; populated now to avoid backfill debt.';

CREATE INDEX IF NOT EXISTS idx_fds_assembly_sessions_template
  ON fds_assembly_sessions(fb_template_id)
  WHERE fb_template_id IS NOT NULL;
