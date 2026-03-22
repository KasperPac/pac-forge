-- Add source tracking to fb_templates so library-imported blocks are
-- distinguishable from custom-authored ones. The PM treats all sources equally
-- (same prompt injection) — source is purely for display/filtering.

ALTER TABLE fb_templates
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'custom'
    CHECK (source IN ('custom', 'library', 'standard')),
  ADD COLUMN IF NOT EXISTS library_name TEXT;

COMMENT ON COLUMN fb_templates.source IS
  'custom = user-authored, library = imported from TIA library doc, standard = Siemens standard instruction';
COMMENT ON COLUMN fb_templates.library_name IS
  'Name of the source library, e.g. "LGF V3.1" (only set when source = library)';
