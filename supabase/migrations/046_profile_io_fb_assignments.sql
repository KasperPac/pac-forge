-- Add IO FB assignments to design profiles
-- Maps signal types (DI, DQ, AI, AQ) to FB template IDs
-- When set, forge wizard wraps every physical IO through the assigned IO FB
ALTER TABLE design_profiles
  ADD COLUMN IF NOT EXISTS io_fb_assignments JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN design_profiles.io_fb_assignments IS
  'Map of signal type (DI/DQ/AI/AQ) → fb_template_id. '
  'When set, every physical IO signal gets wrapped through the IO FB for scaling, filtering, HMI binding.';
