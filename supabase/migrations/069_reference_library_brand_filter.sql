-- Migration 069: Wire up plc_brand filtering in search_reference_sections
--
-- Docs tagged SIEMENS_MIGRATION only appear in the migration pipeline.
-- Docs tagged SIEMENS_TIA (the default) appear everywhere.
-- Callers that pass plc_brand_filter=NULL get all docs (backwards compat).
--
-- Filter logic:
--   plc_brand_filter IS NULL           → no filter, return all (backwards compat)
--   plc_brand_filter = 'SIEMENS_TIA'  → exclude SIEMENS_MIGRATION docs
--   plc_brand_filter = 'SIEMENS_MIGRATION' → include SIEMENS_TIA + SIEMENS_MIGRATION docs

DROP FUNCTION IF EXISTS search_reference_sections(text, text[], integer, text);

CREATE OR REPLACE FUNCTION search_reference_sections(
  search_query      text,
  topic_list        text[],
  max_results       integer DEFAULT 20,
  language_filter   text    DEFAULT NULL,   -- 'LAD', 'SCL', or NULL
  plc_brand_filter  text    DEFAULT NULL    -- 'SIEMENS_TIA', 'SIEMENS_MIGRATION', or NULL
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
    -- Brand filter:
    --   NULL → no filter (return all, backwards compat)
    --   SIEMENS_TIA → only SIEMENS_TIA docs (excludes SIEMENS_MIGRATION)
    --   SIEMENS_MIGRATION → SIEMENS_TIA + SIEMENS_MIGRATION docs (superset)
    AND (
      plc_brand_filter IS NULL
      OR d.plc_brand IS NULL
      OR d.plc_brand = 'SIEMENS_TIA'
      OR d.plc_brand = plc_brand_filter
    )
    -- FTS match OR topic tag overlap
    AND (
      to_tsvector('english', s.content) @@ plainto_tsquery('english', search_query)
      OR s.topic_tags && topic_list
    )
  ORDER BY
    ts_rank(to_tsvector('english', s.content), plainto_tsquery('english', search_query)) DESC,
    cardinality(array(SELECT unnest(s.topic_tags) INTERSECT SELECT unnest(topic_list))) DESC
  LIMIT max_results;
$$;
