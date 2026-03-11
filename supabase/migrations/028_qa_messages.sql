-- Add qa_messages column to forge_sessions
ALTER TABLE forge_sessions
  ADD COLUMN IF NOT EXISTS qa_messages jsonb NOT NULL DEFAULT '[]'::jsonb;
