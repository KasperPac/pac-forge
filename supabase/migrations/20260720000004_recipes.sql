-- G0-14: recipe/format model (named parameter sets + changeover policy).
-- Design: Docs/superpowers/specs/2026-07-20-g0-14-recipe-model-design.md
alter table spec_projects add column if not exists recipes jsonb;
