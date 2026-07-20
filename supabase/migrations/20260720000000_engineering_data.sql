-- G0-1: tier-2 Engineering Data container (record-only commissioning values).
-- First section: drives (HWIDSTW/ZSW, RefSpeed = p2000, ConfigAxis).
-- Design: Docs/superpowers/specs/2026-07-20-g0-1-drive-model-design.md
alter table spec_projects add column if not exists engineering jsonb;
