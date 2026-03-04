-- ============================================================
-- 014: Process Builder sessions for staged pipeline generation
-- ============================================================

-- Enable moddatetime extension for auto-updating updated_at
CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS process_builder_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  current_stage   text NOT NULL DEFAULT 'qa',
  stage_statuses  jsonb NOT NULL DEFAULT '[]'::jsonb,
  qa_answers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  io_recommendations  jsonb NOT NULL DEFAULT '[]'::jsonb,
  fb_recommendations  jsonb NOT NULL DEFAULT '[]'::jsonb,
  folder_structure    jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_gating     boolean NOT NULL DEFAULT false,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One process builder session per session
CREATE UNIQUE INDEX IF NOT EXISTS idx_process_builder_sessions_session
  ON process_builder_sessions(session_id);

-- Lookup by project
CREATE INDEX IF NOT EXISTS idx_process_builder_sessions_project
  ON process_builder_sessions(project_id);

-- Auto-update updated_at
CREATE TRIGGER set_process_builder_sessions_updated_at
  BEFORE UPDATE ON process_builder_sessions
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- RLS
ALTER TABLE process_builder_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own process builder sessions"
  ON process_builder_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own process builder sessions"
  ON process_builder_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own process builder sessions"
  ON process_builder_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own process builder sessions"
  ON process_builder_sessions FOR DELETE
  USING (auth.uid() = user_id);
