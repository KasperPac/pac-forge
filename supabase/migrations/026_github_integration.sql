ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS github_access_token text,
  ADD COLUMN IF NOT EXISTS github_username text;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS github_repo_url text,
  ADD COLUMN IF NOT EXISTS github_repo_name text;
