-- Add interface contract, device brief, and logic check columns to forge_sessions
-- These support the new wizard steps: interface_contract, assembly_fb, logic_check

ALTER TABLE forge_sessions
  ADD COLUMN IF NOT EXISTS interface_contracts jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS device_briefs jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS logic_check_result jsonb DEFAULT NULL;

COMMENT ON COLUMN forge_sessions.interface_contracts IS 'InterfaceContractMap — defines exposed/consumed signals and state machine states per assembly';
COMMENT ON COLUMN forge_sessions.device_briefs IS 'DeviceFbBrief[] — enriched IO signals with intent comments for device FB generation';
COMMENT ON COLUMN forge_sessions.logic_check_result IS 'LogicCheckResult — deterministic + AI validation of assembly FBs';
