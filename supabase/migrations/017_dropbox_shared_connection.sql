-- Make Dropbox connection shared across all team members.
-- Any authenticated user can read the connection; any can connect/disconnect.

-- Track which Pac-Forge user connected the shared Dropbox
ALTER TABLE dropbox_connections ADD COLUMN IF NOT EXISTS connected_by_email text;

-- Replace per-user RLS with shared access for all authenticated users
DROP POLICY IF EXISTS "Users manage own connection" ON dropbox_connections;
CREATE POLICY "Authenticated users can read connection" ON dropbox_connections
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage connection" ON dropbox_connections
  FOR ALL USING (auth.role() = 'authenticated');
