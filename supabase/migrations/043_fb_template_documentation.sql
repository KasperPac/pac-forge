-- Add documentation field to FB templates for manufacturer/library docs
ALTER TABLE fb_templates
  ADD COLUMN IF NOT EXISTS documentation text DEFAULT NULL;

COMMENT ON COLUMN fb_templates.documentation IS 'Full manufacturer documentation for this FB — wiring instructions, parameter descriptions, behaviour, status codes. Injected into generation prompts verbatim.';
