-- spec_sections.granularity — complete the ISA-88 rename (091 / 20260617001222).
-- That migration renamed the columns (assembly_id → equipment_module_id,
-- subsystem_id → unit_id) but left the granularity CHECK constraint and column
-- default on the pre-rename vocabulary, so every V2 writer (random builder,
-- orchestrator, fds-compose) violated spec_sections_granularity_check.

-- 1) drop the old constraint FIRST — the row updates below write values it
--    does not allow
ALTER TABLE spec_sections DROP CONSTRAINT IF EXISTS spec_sections_granularity_check;

-- 2) migrate existing rows to the V2 vocabulary
UPDATE spec_sections SET granularity = 'equipment_module_state' WHERE granularity = 'assembly_state';
UPDATE spec_sections SET granularity = 'unit' WHERE granularity = 'subsystem';

-- 3) re-add with the V2 value set
ALTER TABLE spec_sections
  ADD CONSTRAINT spec_sections_granularity_check
  CHECK (granularity IN ('equipment_module_state', 'unit', 'project'));

-- 4) default follows the vocabulary
ALTER TABLE spec_sections ALTER COLUMN granularity SET DEFAULT 'equipment_module_state';

COMMENT ON COLUMN spec_sections.granularity IS 'Scope of this section: equipment_module_state | unit | project.';
