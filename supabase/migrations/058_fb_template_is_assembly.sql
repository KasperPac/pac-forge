-- Add is_assembly flag to fb_templates to distinguish assembly-level templates
-- from device-level templates. Assembly templates coordinate groups of devices
-- (e.g. lift tables, conveyors) while device templates are for individual IO things.

ALTER TABLE fb_templates ADD COLUMN is_assembly boolean NOT NULL DEFAULT false;

-- Also add assembly_list and assembly_artifacts to forge_sessions
ALTER TABLE forge_sessions ADD COLUMN assembly_list jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE forge_sessions ADD COLUMN assembly_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb;
