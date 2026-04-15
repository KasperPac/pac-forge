-- Link spec_projects to projects table (specs are per-project, not global)
ALTER TABLE spec_projects
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Make client_name nullable (inherited from project)
ALTER TABLE spec_projects
  ALTER COLUMN client_name DROP NOT NULL;
