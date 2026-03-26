-- Clients table: reusable client entities linked to projects
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  short_code text,              -- optional short prefix (e.g. "CK", "ACME")
  contact_name text,
  contact_email text,
  notes text,
  created_by uuid REFERENCES auth.users NOT NULL DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique name per user
CREATE UNIQUE INDEX idx_clients_name_user ON clients (created_by, lower(name));

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_clients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_clients_updated_at();

-- RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select_own" ON clients
  FOR SELECT TO authenticated USING (created_by = auth.uid());
CREATE POLICY "clients_insert_own" ON clients
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "clients_update_own" ON clients
  FOR UPDATE TO authenticated USING (created_by = auth.uid());
CREATE POLICY "clients_delete_own" ON clients
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- Add client_id FK to projects (nullable for backward compat with existing projects)
ALTER TABLE projects ADD COLUMN client_id uuid REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX idx_projects_client_id ON projects (client_id);
