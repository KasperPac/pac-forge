-- G0-9: per-unit PackML state machine + mode manager configuration.
-- Shape: Record<unit_id, UnitCoordinationV1> (see src/types/spec-contract-v2.ts).
-- Null = not authored (optional during the additive wave).
alter table public.spec_projects
  add column if not exists unit_coordination jsonb;

comment on column public.spec_projects.unit_coordination is
  'G0-9 unit coordination: Record<unit_id, UnitCoordinationV1> — PackML unit state machines, mode masks, EM command overrides. Null = not authored.';
