-- Add system_description to spec_projects for the top-level machine description
ALTER TABLE spec_projects ADD COLUMN IF NOT EXISTS system_description TEXT;
