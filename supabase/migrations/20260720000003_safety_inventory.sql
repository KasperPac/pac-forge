-- G0-13: safety layer inventory (record-only, signable; never generated).
-- Design: Docs/superpowers/specs/2026-07-20-g0-13-safety-inventory-design.md
alter table spec_projects add column if not exists safety_inventory jsonb;
