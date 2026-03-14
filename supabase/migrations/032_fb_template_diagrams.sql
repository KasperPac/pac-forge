-- Add logic diagram fields to fb_templates
ALTER TABLE fb_templates
  ADD COLUMN IF NOT EXISTS diagram_chart TEXT,
  ADD COLUMN IF NOT EXISTS diagram_generated_at TIMESTAMPTZ;
