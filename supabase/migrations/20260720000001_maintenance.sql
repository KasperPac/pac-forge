-- G0-5: maintenance capabilities (overridable outputs; preset capability
-- rides unit_coordination axes, preset channels ride engineering).
-- Design: Docs/superpowers/specs/2026-07-20-g0-5-maintenance-config-design.md
alter table spec_projects add column if not exists maintenance jsonb;
