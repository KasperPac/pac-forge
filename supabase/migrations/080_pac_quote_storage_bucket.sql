-- ============================================================
-- 080_pac_quote_storage_bucket.sql
-- Pac-Quote: Storage bucket for issued quote PDFs.
--   Bucket: quote-pdfs (private)
--   Path layout: quote-revisions/{rev_id}/{filename}.pdf
--   Read/write/update allowed for authenticated users via RLS.
--   No delete policy — issued PDFs are immutable history.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('quote-pdfs', 'quote-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can read any PDF in the bucket. Pre-issue dry-run
-- previews never hit the bucket; only issued/persisted PDFs land here.
CREATE POLICY "quote_pdfs_authenticated_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'quote-pdfs');

-- Uploads come from the quote-render-pdf Edge Function running as the
-- service role; the authenticated insert policy exists for parity with
-- the read policy and to support the rare case where a user must
-- re-upload (e.g. PDF regenerated from same snapshot post-deploy).
CREATE POLICY "quote_pdfs_authenticated_write"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'quote-pdfs');

CREATE POLICY "quote_pdfs_authenticated_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'quote-pdfs')
  WITH CHECK (bucket_id = 'quote-pdfs');
