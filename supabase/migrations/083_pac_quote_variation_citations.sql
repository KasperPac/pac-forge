-- ============================================================
-- 083_pac_quote_variation_citations.sql
-- Pac-Quote v2: variation_citations table.
--   Records the provenance of each content row inside a variation
--   by linking it back to the originating item in another snapshot.
--   Citations are immutable — no updated_at / moddatetime.
-- ============================================================

-- ------------------------------------------------------------
-- variation_citations
-- ------------------------------------------------------------
CREATE TABLE variation_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_id uuid NOT NULL REFERENCES variations(id) ON DELETE CASCADE,
  target_section text NOT NULL
    CHECK (target_section IN ('scope','inclusion','exclusion','assumption','line_item')),
  target_doc_id uuid NOT NULL,
  source_kind text NOT NULL
    CHECK (source_kind IN ('quote_revision','variation')),
  source_id uuid NOT NULL,
  source_section text NOT NULL,
  source_item_id uuid NOT NULL,
  original_text_verbatim text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (variation_id, target_section, target_doc_id)
);

CREATE INDEX variation_citations_variation_idx
  ON variation_citations(variation_id);
CREATE INDEX variation_citations_source_idx
  ON variation_citations(source_kind, source_id);

-- ------------------------------------------------------------
-- RLS — full four-policy authenticated set.
-- Citations are inserted by the app and queried freely; update
-- and delete are permitted so the app can manage rows if needed.
-- ------------------------------------------------------------
ALTER TABLE variation_citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY variation_citations_select_authenticated ON variation_citations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY variation_citations_insert_authenticated ON variation_citations
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY variation_citations_update_authenticated ON variation_citations
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY variation_citations_delete_authenticated ON variation_citations
  FOR DELETE TO authenticated USING (true);
