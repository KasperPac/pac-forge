-- 050: Persist Dropbox root path in user profiles

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS dropbox_root_path text;
