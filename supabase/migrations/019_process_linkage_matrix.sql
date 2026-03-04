-- Add linkage_matrix column to process_builder_sessions
ALTER TABLE process_builder_sessions
  ADD COLUMN IF NOT EXISTS linkage_matrix jsonb DEFAULT NULL;
