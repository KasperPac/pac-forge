-- Phase 5 of assembly FB library: add interface_contract to fds_assembly_sessions.
-- Stores the authored FbInterfaceContract for custom-path assemblies (no library template).
-- Library-bound assemblies ignore this field — their contract lives in fb_templates.interface_contract.

ALTER TABLE fds_assembly_sessions
  ADD COLUMN IF NOT EXISTS interface_contract jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN fds_assembly_sessions.interface_contract IS
  'Authored FbInterfaceContract (inputs, outputs, io_slots, process_state_reads/writes) for custom-path assemblies. Empty {} until the engineer authors it in the wizard. Library-bound assemblies (fb_template_id set) use the contract from fb_templates.interface_contract instead.';
