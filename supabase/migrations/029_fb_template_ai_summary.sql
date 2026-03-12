-- Add AI-generated summary to FB templates
-- Used by the PM agent to semantically match devices to templates without relying on naming

ALTER TABLE fb_templates ADD COLUMN IF NOT EXISTS ai_summary TEXT;

COMMENT ON COLUMN fb_templates.ai_summary IS
  'AI-generated description of what this FB does, what device types it suits, and its IO interface. Used for semantic matching during Forge device assignment.';
