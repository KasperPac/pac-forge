-- Add audit_type column to audit_projects
ALTER TABLE audit_projects
  ADD COLUMN audit_type text NOT NULL DEFAULT 'full'
    CHECK (audit_type IN ('targeted', 'full'));
