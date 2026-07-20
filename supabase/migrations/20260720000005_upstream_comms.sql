-- G0-12: upstream comms interface list (SCADA/MES/historian data crossing).
-- Endpoints/tag exposure ride engineering jsonb.
-- Design: Docs/superpowers/specs/2026-07-20-g0-12-upstream-comms-design.md
alter table spec_projects add column if not exists upstream_comms jsonb;
