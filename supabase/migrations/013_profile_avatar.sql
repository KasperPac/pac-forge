-- ============================================================
-- 013: Add avatar_url to profiles table
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;
