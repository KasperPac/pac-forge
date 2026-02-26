-- Knowledge priority overrides: stores permanent conflict resolution rules
create table if not exists knowledge_priority_overrides (
  id uuid default gen_random_uuid() primary key,
  source_a text not null,          -- e.g. 'CORRECTION_PATTERN'
  source_b text not null,          -- e.g. 'DESIGN_PROFILE'
  winner text not null,            -- which source wins (must be source_a or source_b)
  scope text not null default 'global',  -- 'global' or 'category:NAMING', 'category:IO_MAPPING', etc.
  reason text,                     -- user's note about why this override exists
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),

  constraint valid_winner check (winner = source_a or winner = source_b),
  constraint unique_override unique (source_a, source_b, scope)
);

-- Enable RLS
alter table knowledge_priority_overrides enable row level security;

-- Allow authenticated users full access
create policy "Authenticated users can read priority overrides"
  on knowledge_priority_overrides for select
  to authenticated
  using (true);

create policy "Authenticated users can insert priority overrides"
  on knowledge_priority_overrides for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update priority overrides"
  on knowledge_priority_overrides for update
  to authenticated
  using (true);

create policy "Authenticated users can delete priority overrides"
  on knowledge_priority_overrides for delete
  to authenticated
  using (true);
