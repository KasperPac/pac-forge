-- Dropbox OAuth connections (per user)
CREATE TABLE IF NOT EXISTS dropbox_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  account_id text,
  display_name text,
  email text,
  connected_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE dropbox_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own connection" ON dropbox_connections
  FOR ALL USING (auth.uid() = user_id);

-- New project columns for Dropbox folder management
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description_short text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description_long text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dropbox_folder_path text;
