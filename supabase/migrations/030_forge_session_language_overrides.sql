-- Add language preference overrides to forge_sessions
-- These allow the project setup form to persist language choices independently
-- of the design profile, so user overrides survive navigation between steps.

ALTER TABLE forge_sessions
  ADD COLUMN IF NOT EXISTS device_fb_language TEXT CHECK (device_fb_language IN ('SCL', 'LAD')),
  ADD COLUMN IF NOT EXISTS io_linking_language TEXT CHECK (io_linking_language IN ('SCL', 'LAD')),
  ADD COLUMN IF NOT EXISTS process_code_language TEXT CHECK (process_code_language IN ('SCL', 'LAD'));
