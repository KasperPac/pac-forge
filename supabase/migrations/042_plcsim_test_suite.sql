-- Add PLCSIM test suite column to forge_sessions
ALTER TABLE forge_sessions
  ADD COLUMN IF NOT EXISTS plcsim_test_suite jsonb DEFAULT NULL;

COMMENT ON COLUMN forge_sessions.plcsim_test_suite IS 'PLCSIM Advanced test suite — test cases, IO simulation rules, and results';
