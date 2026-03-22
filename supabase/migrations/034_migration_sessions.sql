-- Migration: S7-300/400 to S7-1500 Migration Wizard sessions
-- Stores state for each migration project

CREATE TABLE IF NOT EXISTS migration_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  current_step  TEXT NOT NULL DEFAULT 'connect',

  -- Source blocks exported from TIA Portal (key = block name, value = SCL source)
  source_blocks       JSONB NOT NULL DEFAULT '{}',
  source_block_count  INTEGER NOT NULL DEFAULT 0,

  -- AI analysis result
  analysis_summary TEXT,

  -- Migration plan: array of MigrationPlanStep objects
  migration_plan JSONB NOT NULL DEFAULT '[]',

  -- Transformed blocks: array of MigratedBlock objects
  migrated_blocks JSONB NOT NULL DEFAULT '[]',

  -- Review findings: array of ReviewFinding objects
  review_findings JSONB NOT NULL DEFAULT '[]',

  -- Compile result from TIA bridge
  compile_result JSONB,

  -- Final markdown report
  report_markdown TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE migration_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own migration sessions"
  ON migration_sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_migration_sessions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_migration_sessions_updated_at
  BEFORE UPDATE ON migration_sessions
  FOR EACH ROW EXECUTE FUNCTION update_migration_sessions_updated_at();
