-- G0-11: appliance model (inventory, placement, handshakes, data payloads).
-- Design: Docs/superpowers/specs/2026-07-20-g0-11-appliance-model-design.md
alter table spec_projects add column if not exists appliances jsonb;
