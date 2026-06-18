-- Hybrid per-EM state model.
-- Machine-level safety gates on the project; per-EM state machine on the
-- operation session rows. Nothing to backfill (only V2 test specs exist).

alter table public.spec_projects
  add column if not exists safety_gates jsonb not null default '[]'::jsonb;

alter table public.fds_operation_sessions
  add column if not exists em_states jsonb not null default '[]'::jsonb,
  add column if not exists em_transitions jsonb not null default '[]'::jsonb;

comment on column public.spec_projects.safety_gates is
  'SafetyGateV2[] — machine-level safety gates (force scoped EMs to safe).';
comment on column public.fds_operation_sessions.em_states is
  'EmStateV2[] — the EM''s own states (hybrid state model).';
comment on column public.fds_operation_sessions.em_transitions is
  'EmTransitionV2[] — the EM''s own transitions.';
