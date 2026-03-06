-- ============================================================
-- 020: Add pipeline_log column to process_builder_sessions
-- Stores full agent pipeline conversation history (system prompts,
-- user messages, raw responses) for transcript browsing and
-- follow-up chat context.
-- ============================================================

ALTER TABLE process_builder_sessions
  ADD COLUMN IF NOT EXISTS pipeline_log jsonb NOT NULL DEFAULT '[]'::jsonb;
