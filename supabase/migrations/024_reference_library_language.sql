-- Migration 024: Add programming_language to reference_library_docs
-- Allows filtering reference lookups by LAD vs SCL to prevent cross-contamination.

-- Add column with GENERAL as default (existing docs are language-agnostic)
ALTER TABLE reference_library_docs
  ADD COLUMN IF NOT EXISTS programming_language text NOT NULL DEFAULT 'GENERAL'
  CHECK (programming_language IN ('LAD', 'SCL', 'GENERAL'));

-- Replace search_reference_sections to support optional language filtering.
-- GENERAL docs always match regardless of filter (they apply to all languages).
-- When language_filter = 'LAD': return sections from LAD + GENERAL docs.
-- When language_filter = 'SCL': return sections from SCL + GENERAL docs.
-- When language_filter IS NULL: return all sections.
DROP FUNCTION IF EXISTS search_reference_sections(text, text[], integer);

CREATE OR REPLACE FUNCTION search_reference_sections(
  search_query  text,
  topic_list    text[],
  max_results   integer DEFAULT 20,
  language_filter text DEFAULT NULL  -- 'LAD', 'SCL', or NULL (no filter)
)
RETURNS TABLE (
  id            uuid,
  doc_id        uuid,
  section_index integer,
  heading       text,
  content       text,
  char_count    integer,
  topic_tags    text[],
  created_at    timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    s.id,
    s.doc_id,
    s.section_index,
    s.heading,
    s.content,
    s.char_count,
    s.topic_tags,
    s.created_at
  FROM reference_library_sections s
  JOIN reference_library_docs d ON d.id = s.doc_id
  WHERE
    -- Language filter: GENERAL docs always match; specific docs only when language matches
    (
      language_filter IS NULL
      OR d.programming_language = 'GENERAL'
      OR d.programming_language = language_filter
    )
    -- FTS match OR topic tag overlap
    AND (
      to_tsvector('english', s.content) @@ plainto_tsquery('english', search_query)
      OR s.topic_tags && topic_list
    )
  ORDER BY
    -- Rank by FTS score + tag overlap count
    ts_rank(to_tsvector('english', s.content), plainto_tsquery('english', search_query)) DESC,
    cardinality(array(SELECT unnest(s.topic_tags) INTERSECT SELECT unnest(topic_list))) DESC
  LIMIT max_results;
$$;
