-- G0-16: hardware model (CPU + racks/modules) authored at the skeleton stage.
-- Tier-2 realization data; read by loadSpecContract into contract.hardware.
-- Design: Docs/superpowers/specs/2026-07-24-hardware-in-fds-design.md
alter table spec_projects add column if not exists hardware jsonb;
