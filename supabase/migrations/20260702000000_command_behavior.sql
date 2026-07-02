-- SP-3c: command-conditional device holds per acting PackML state, authored by
-- Stage B of the FDS co-author. Record<state_id, CommandBehaviorV2>. Nullable,
-- additive — existing rows read NULL (treated as absent by the app).
alter table fds_operation_sessions
  add column if not exists command_behavior jsonb;

comment on column fds_operation_sessions.command_behavior is
  'Command-conditional device holds per acting PackML state (SP-3c). Record<state_id, CommandBehaviorV2>.';
