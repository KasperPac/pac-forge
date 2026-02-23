-- PAC-FORGE: Initial Schema
-- All tables for Pac-ST system per PAC_ST_MASTER_SPEC + PAC_ST_SPEC

-- ============================================================
-- PROFILES
-- ============================================================
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'ENGINEER' check (role in ('ENGINEER', 'ADMIN')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select using (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = user_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email), 'ENGINEER');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- PROJECTS
-- ============================================================
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  plc_brand text not null default 'SIEMENS_TIA' check (plc_brand in ('SIEMENS_TIA')),
  tia_version text not null default 'V17',
  cpu_type text not null default 'S7-1500' check (cpu_type in ('S7-1200', 'S7-1500')),
  rack_slot_layout jsonb not null default '[]'::jsonb,
  io_lists jsonb not null default '[]'::jsonb,
  tag_db_definitions jsonb not null default '[]'::jsonb,
  uploaded_docs text[] not null default '{}',
  safety_level text not null default '',
  safety_notes text not null default '',
  revision_log jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy "Users can read own projects"
  on public.projects for select using (auth.uid() = created_by);

create policy "Users can insert own projects"
  on public.projects for insert with check (auth.uid() = created_by);

create policy "Users can update own projects"
  on public.projects for update using (auth.uid() = created_by);

create policy "Users can delete own projects"
  on public.projects for delete using (auth.uid() = created_by);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ============================================================
-- AGENTS
-- ============================================================
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  specialties text[] not null default '{}',
  is_enabled boolean not null default true,
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'RESERVED', 'OFFLINE', 'DISABLED')),
  max_concurrency integer not null default 1,
  system_prompt text not null default '',
  created_at timestamptz not null default now()
);

alter table public.agents enable row level security;

-- Agents are readable by all authenticated users
create policy "Authenticated users can read agents"
  on public.agents for select using (auth.role() = 'authenticated');

-- Only admins can modify agents
create policy "Admins can manage agents"
  on public.agents for all using (
    exists (select 1 from public.profiles where user_id = auth.uid() and role = 'ADMIN')
  );

-- ============================================================
-- SESSIONS
-- ============================================================
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  selected_agent_ids text[] not null default '{}',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED', 'EXPIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sessions enable row level security;

create policy "Users can read own sessions"
  on public.sessions for select using (auth.uid() = user_id);

create policy "Users can insert own sessions"
  on public.sessions for insert with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.sessions for update using (auth.uid() = user_id);

create trigger sessions_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

-- ============================================================
-- AGENT RESERVATIONS
-- ============================================================
create table public.agent_reservations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  reserved_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default (now() + interval '30 minutes'),
  released_at timestamptz,
  release_reason text check (release_reason in ('USER_RELEASE', 'SESSION_END', 'LEASE_TIMEOUT', 'ADMIN_FORCE'))
);

alter table public.agent_reservations enable row level security;

create policy "Users can read own reservations"
  on public.agent_reservations for select using (auth.uid() = user_id);

create policy "Users can insert own reservations"
  on public.agent_reservations for insert with check (auth.uid() = user_id);

create policy "Users can update own reservations"
  on public.agent_reservations for update using (auth.uid() = user_id);

-- ============================================================
-- CONVERSATION TURNS
-- ============================================================
create table public.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  role text not null check (role in ('USER', 'AGENT')),
  agent_id uuid references public.agents(id),
  content text not null,
  artifacts_generated jsonb not null default '[]'::jsonb,
  safety_warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.conversation_turns enable row level security;

create policy "Users can read own conversation turns"
  on public.conversation_turns for select using (
    exists (select 1 from public.sessions where id = session_id and user_id = auth.uid())
  );

create policy "Users can insert own conversation turns"
  on public.conversation_turns for insert with check (
    exists (select 1 from public.sessions where id = session_id and user_id = auth.uid())
  );

-- ============================================================
-- ARTIFACTS
-- ============================================================
create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null,
  type text not null check (type in ('UDT', 'FB', 'FC', 'DB', 'OB', 'SCL_SOURCE', 'TAG_TABLE')),
  filename text not null,
  content text not null,
  approved_content text,
  destination_folder text not null default '',
  dependencies text[] not null default '{}',
  compile_after_import boolean not null default true,
  overwrite_strategy text not null default 'CREATE_OR_UPDATE'
    check (overwrite_strategy in ('CREATE_OR_UPDATE', 'FAIL_IF_EXISTS', 'CREATE_NEW_VERSION')),
  safety_warnings jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table public.artifacts enable row level security;

create policy "Users can read own artifacts"
  on public.artifacts for select using (
    exists (select 1 from public.projects where id = project_id and created_by = auth.uid())
  );

create policy "Users can insert own artifacts"
  on public.artifacts for insert with check (
    exists (select 1 from public.projects where id = project_id and created_by = auth.uid())
  );

create policy "Users can update own artifacts"
  on public.artifacts for update using (
    exists (select 1 from public.projects where id = project_id and created_by = auth.uid())
  );

-- ============================================================
-- SNAPSHOTS
-- ============================================================
create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  content text not null,
  trigger text not null check (trigger in ('GENERATION', 'APPROVAL', 'EXPORT')),
  version_number integer not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.snapshots enable row level security;

create policy "Users can read own snapshots"
  on public.snapshots for select using (
    exists (select 1 from public.projects where id = project_id and created_by = auth.uid())
  );

create policy "Users can insert own snapshots"
  on public.snapshots for insert with check (auth.uid() = created_by);

-- ============================================================
-- PATTERN CANDIDATES
-- ============================================================
create table public.pattern_candidates (
  id uuid primary key default gen_random_uuid(),
  plc_brand text not null,
  device_type text not null default '',
  context text not null default '',
  original_snippet text not null,
  corrected_snippet text not null,
  correction_type text not null check (correction_type in ('NAMING', 'IO_MAPPING', 'STATE_LOGIC', 'ALARM', 'SAFETY', 'TIMING')),
  explanation_tag text not null default '',
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.pattern_candidates enable row level security;

-- All authenticated users can read approved patterns
create policy "Authenticated users can read patterns"
  on public.pattern_candidates for select using (auth.role() = 'authenticated');

create policy "Users can insert patterns"
  on public.pattern_candidates for insert with check (auth.uid() = created_by);

-- Only admins can approve/reject
create policy "Admins can update patterns"
  on public.pattern_candidates for update using (
    exists (select 1 from public.profiles where user_id = auth.uid() and role = 'ADMIN')
  );

-- ============================================================
-- TIA JOBS
-- ============================================================
create table public.tia_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  job_type text not null check (job_type in ('IMPORT_ONLY', 'IMPORT_AND_COMPILE', 'COMPILE_ONLY', 'EXPORT_REPORT')),
  manifest jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  compile_results jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.tia_jobs enable row level security;

create policy "Users can read own tia jobs"
  on public.tia_jobs for select using (
    exists (select 1 from public.projects where id = project_id and created_by = auth.uid())
  );

create policy "Users can insert own tia jobs"
  on public.tia_jobs for insert with check (auth.uid() = created_by);

create policy "Users can update own tia jobs"
  on public.tia_jobs for update using (auth.uid() = created_by);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  project_id uuid references public.projects(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

create policy "Users can read own audit logs"
  on public.audit_logs for select using (auth.uid() = user_id);

create policy "Users can insert own audit logs"
  on public.audit_logs for insert with check (auth.uid() = user_id);

-- Admins can read all audit logs
create policy "Admins can read all audit logs"
  on public.audit_logs for select using (
    exists (select 1 from public.profiles where user_id = auth.uid() and role = 'ADMIN')
  );

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_projects_created_by on public.projects(created_by);
create index idx_sessions_user_id on public.sessions(user_id);
create index idx_sessions_project_id on public.sessions(project_id);
create index idx_agent_reservations_agent_id on public.agent_reservations(agent_id);
create index idx_agent_reservations_session_id on public.agent_reservations(session_id);
create index idx_conversation_turns_session_id on public.conversation_turns(session_id);
create index idx_artifacts_project_id on public.artifacts(project_id);
create index idx_artifacts_session_id on public.artifacts(session_id);
create index idx_snapshots_artifact_id on public.snapshots(artifact_id);
create index idx_pattern_candidates_status on public.pattern_candidates(status);
create index idx_tia_jobs_project_id on public.tia_jobs(project_id);
create index idx_audit_logs_user_id on public.audit_logs(user_id);
create index idx_audit_logs_project_id on public.audit_logs(project_id);

-- ============================================================
-- SEED: Default Agents
-- ============================================================
insert into public.agents (display_name, specialties, is_enabled, status, max_concurrency, system_prompt) values
(
  'Code Architect',
  '{"TIA", "REVIEW"}',
  true, 'AVAILABLE', 1,
  'You are a senior PLC code architect specializing in Siemens TIA Portal. You design structured, deterministic PLC programs using CASE-based state machines. You produce build-ready SCL code with proper UDT/FB/FC/DB separation. You follow array-first architecture and deterministic naming conventions.'
),
(
  'PLC Standards Enforcer',
  '{"TIA", "REVIEW"}',
  true, 'AVAILABLE', 1,
  'You enforce PLC coding standards. You verify deterministic CASE-based state machines, proper alarm latching (no auto-reset, operator reset only), correct IO indexing with bounds validation, and consistent naming conventions. You reject code that does not meet quality standards.'
),
(
  'IO Validator',
  '{"IO", "TIA"}',
  true, 'AVAILABLE', 1,
  'You validate IO mappings for PLC programs. You verify deterministic and explicit IO indexing, UDT + array structures for IO, index bounds checking, and flag misalignment risks as high severity. You ensure no wrong-device-linking can occur due to mapping mistakes.'
),
(
  'Safety Auditor',
  '{"SAFETY", "REVIEW"}',
  true, 'AVAILABLE', 1,
  'You audit PLC code for safety. You detect unsafe motor logic, missing interlocks, IO index mismatches, alarm reset violations, array out-of-bounds risks, and uninitialized states. You flag all safety issues prominently but allow generation with explicit user confirmation.'
),
(
  'Pattern Librarian',
  '{"PATTERNS", "REVIEW"}',
  true, 'AVAILABLE', 1,
  'You manage the pattern library. You classify corrections (naming, IO mapping, state logic, alarm handling, safety, timing) from diffs between generated and approved code. You apply approved patterns to future generations deterministically and log pattern usage.'
);
