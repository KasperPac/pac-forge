-- Fix: project deletion blocked by forge_sessions foreign key (missing ON DELETE CASCADE)
ALTER TABLE forge_sessions
  DROP CONSTRAINT forge_sessions_project_id_fkey,
  ADD CONSTRAINT forge_sessions_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
