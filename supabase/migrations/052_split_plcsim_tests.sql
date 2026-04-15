-- Split PLCSIM testing into Device FB Tests (after device code) and System Tests (after process code)
ALTER TABLE forge_sessions ADD COLUMN IF NOT EXISTS plcsim_device_test_suite jsonb;
