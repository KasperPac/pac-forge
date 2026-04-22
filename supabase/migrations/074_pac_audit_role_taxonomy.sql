-- ============================================================
-- 074_pac_audit_role_taxonomy.sql
-- Pac-Audit classification taxonomy refresh.
--   • Drop the `_fb` suffix from role values (naming was wrong for
--     FCs — same semantics, cleaner reading).
--   • Add four new roles: io_mapper, dispatcher, fault, logic.
--
-- See Docs/PAC_AUDIT_DERIVED_SPEC.md §5 (retuned rule cascade).
-- ============================================================

-- 1. Drop old CHECK constraints
ALTER TABLE audit_fb_classifications
  DROP CONSTRAINT IF EXISTS audit_fb_classifications_role_check,
  DROP CONSTRAINT IF EXISTS audit_fb_classifications_engineer_override_role_check;

-- 2. Rename existing rows — drop `_fb` suffix on 7 values; `ob` and
--    `unknown` unchanged. Apply to both role and engineer_override_role.
UPDATE audit_fb_classifications SET role = CASE role
  WHEN 'device_fb'    THEN 'device'
  WHEN 'assembly_fb'  THEN 'assembly'
  WHEN 'subsystem_fb' THEN 'subsystem'
  WHEN 'sequence_fb'  THEN 'sequence'
  WHEN 'utility_fb'   THEN 'utility'
  WHEN 'safety_fb'    THEN 'safety'
  WHEN 'comms_fb'     THEN 'comms'
  ELSE role
END
WHERE role IN (
  'device_fb','assembly_fb','subsystem_fb','sequence_fb',
  'utility_fb','safety_fb','comms_fb'
);

UPDATE audit_fb_classifications SET engineer_override_role = CASE engineer_override_role
  WHEN 'device_fb'    THEN 'device'
  WHEN 'assembly_fb'  THEN 'assembly'
  WHEN 'subsystem_fb' THEN 'subsystem'
  WHEN 'sequence_fb'  THEN 'sequence'
  WHEN 'utility_fb'   THEN 'utility'
  WHEN 'safety_fb'    THEN 'safety'
  WHEN 'comms_fb'     THEN 'comms'
  ELSE engineer_override_role
END
WHERE engineer_override_role IN (
  'device_fb','assembly_fb','subsystem_fb','sequence_fb',
  'utility_fb','safety_fb','comms_fb'
);

-- 3. Add new CHECK constraints with the 13-value taxonomy
ALTER TABLE audit_fb_classifications
  ADD CONSTRAINT audit_fb_classifications_role_check
    CHECK (role IN (
      'device', 'io_mapper', 'dispatcher', 'assembly', 'subsystem',
      'sequence', 'utility', 'safety', 'comms', 'fault', 'logic',
      'ob', 'unknown'
    )),
  ADD CONSTRAINT audit_fb_classifications_engineer_override_role_check
    CHECK (engineer_override_role IS NULL OR engineer_override_role IN (
      'device', 'io_mapper', 'dispatcher', 'assembly', 'subsystem',
      'sequence', 'utility', 'safety', 'comms', 'fault', 'logic',
      'ob', 'unknown'
    ));
