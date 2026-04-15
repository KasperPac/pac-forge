-- Forge wizard ↔ FDS builder integration
-- Adds FDS linking, interface contracts, device briefs, and logic check columns

ALTER TABLE forge_sessions
  ADD COLUMN IF NOT EXISTS spec_project_id uuid REFERENCES spec_projects(id) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS interface_contracts jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS device_briefs jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS logic_check_result jsonb DEFAULT NULL;

COMMENT ON COLUMN forge_sessions.spec_project_id IS 'Links to FDS spec_project — when set, forge reads behavioral data from fds_assembly_sessions';
COMMENT ON COLUMN forge_sessions.interface_contracts IS 'InterfaceContractMap — standalone path only (no FDS). Replaced by FDS behavioral data when spec_project_id is set.';
COMMENT ON COLUMN forge_sessions.device_briefs IS 'DeviceFbBrief[] — enriched IO signals with intent comments for device FB generation';
COMMENT ON COLUMN forge_sessions.logic_check_result IS 'LogicCheckResult — deterministic + AI validation of assembly FBs against FDS';

CREATE INDEX IF NOT EXISTS idx_forge_sessions_spec_project ON forge_sessions(spec_project_id) WHERE spec_project_id IS NOT NULL;
