-- G0-10: authorization role ladder (per-item access rides the other
-- constructs' jsonb; this is the project ladder).
-- Design: Docs/superpowers/specs/2026-07-20-g0-10-authorization-design.md
alter table spec_projects add column if not exists authorization jsonb;
