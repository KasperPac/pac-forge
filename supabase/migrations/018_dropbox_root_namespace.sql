-- Store Dropbox root_namespace_id for Business/Team accounts.
-- Required to access team folders via Dropbox-API-Path-Root header.
ALTER TABLE dropbox_connections ADD COLUMN IF NOT EXISTS root_namespace_id text;
