-- FB interface contract — structured, human-reviewed pin descriptor per template.
-- Nullable: legacy templates have no contract until authored. Inherits fb_templates RLS.

ALTER TABLE fb_templates
  ADD COLUMN interface_contract JSONB;

COMMENT ON COLUMN fb_templates.interface_contract IS
  'FbInterfaceContract: role-tagged pins + binding hints + reviewed flag. Authored in the FB Library; consumed by Phase 3.5 Device FB Binding.';
