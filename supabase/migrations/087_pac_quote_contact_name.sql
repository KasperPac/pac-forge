-- Add per-quote contact name to quote revisions and variations.
-- This drives the salutation in the intro letter ("Hi {contact},").
ALTER TABLE quote_revisions ADD COLUMN contact_name text;
ALTER TABLE variations ADD COLUMN contact_name text;
