-- Phase 5 of assembly FB library: persist generated SCL blocks alongside
-- the interface_contract on each assembly session, so custom-path AI
-- generation can be reviewed in the wizard, survives reload, drives the
-- forge step, and feeds the Promote-to-library workflow.

ALTER TABLE fds_assembly_sessions
  ADD COLUMN IF NOT EXISTS generated_scl_blocks jsonb NOT NULL DEFAULT '[]';

COMMENT ON COLUMN fds_assembly_sessions.generated_scl_blocks IS
  'Array of {block_name, block_type, scl_code, sort_order} entries produced by AI-against-contract generation in the spec wizard. Empty for library-bound assemblies (SCL comes from fb_templates.blocks at forge time). Empty for custom assemblies before the engineer clicks Generate SCL.';
