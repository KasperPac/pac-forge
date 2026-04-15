-- Spec Builder V2: Industry-standard FDS section types + scope/philosophy fields
-- Supports 9-section document structure (Sections 0-8) per PAC-EFD standard

-- ============================================================
-- 1. Expand section_type CHECK constraint to include V2 types
-- ============================================================
ALTER TABLE spec_sections DROP CONSTRAINT IF EXISTS spec_sections_section_type_check;

ALTER TABLE spec_sections ADD CONSTRAINT spec_sections_section_type_check
  CHECK (section_type IN (
    -- V2 section types
    'document_control',
    'system_overview',
    'control_philosophy',
    'functional_description',
    'io_list',
    'alarm_specification',
    'hmi_specification',
    'interfaces',
    'testing_fat',
    'audit_report',
    -- Legacy V1 types (backward compatibility)
    'introduction',
    'equipment_description',
    'functional_state',
    'alarm_table',
    'settings_table'
  ));

-- ============================================================
-- 2. Add scope & philosophy fields to spec_projects
-- ============================================================
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS scope_exclusions JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS safety_classification TEXT,
  ADD COLUMN IF NOT EXISTS fault_philosophy TEXT,
  ADD COLUMN IF NOT EXISTS design_principles JSONB DEFAULT '[]';
