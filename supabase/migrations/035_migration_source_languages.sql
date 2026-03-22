-- Migration: Add source_block_languages to migration_sessions
-- Stores the programming language per exported block (SCL, STL, LAD, FBD, GRAPH, DB)

ALTER TABLE migration_sessions
  ADD COLUMN IF NOT EXISTS source_block_languages JSONB NOT NULL DEFAULT '{}';

-- Also add source PLC hardware fields that were added in the frontend but not in the original migration
ALTER TABLE migration_sessions
  ADD COLUMN IF NOT EXISTS source_plc_family TEXT,
  ADD COLUMN IF NOT EXISTS source_cpu_type_id TEXT,
  ADD COLUMN IF NOT EXISTS target_cpu_order_number TEXT,
  ADD COLUMN IF NOT EXISTS target_project_path TEXT;
