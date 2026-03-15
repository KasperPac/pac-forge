-- Add AI-generated signal flow diagram JSON to fb_templates
ALTER TABLE fb_templates
  ADD COLUMN IF NOT EXISTS flow_diagram_json TEXT,
  ADD COLUMN IF NOT EXISTS flow_diagram_generated_at TIMESTAMPTZ;
