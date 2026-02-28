-- 010: Add short IDs to agent_knowledge_docs (K-0001) and pattern_candidates (P-0001)
-- These provide stable, citable references for agents and users.

-- ============================================================
-- 1. Sequences
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS knowledge_short_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS pattern_short_id_seq START 1;

-- ============================================================
-- 2. Add nullable columns first (for backfill)
-- ============================================================
ALTER TABLE agent_knowledge_docs ADD COLUMN IF NOT EXISTS short_id text;
ALTER TABLE pattern_candidates   ADD COLUMN IF NOT EXISTS short_id text;

-- ============================================================
-- 3. Backfill existing rows in created_at order
-- ============================================================
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
  FROM agent_knowledge_docs
  WHERE short_id IS NULL
)
UPDATE agent_knowledge_docs SET short_id = 'K-' || LPAD(numbered.rn::text, 4, '0')
FROM numbered WHERE agent_knowledge_docs.id = numbered.id;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
  FROM pattern_candidates
  WHERE short_id IS NULL
)
UPDATE pattern_candidates SET short_id = 'P-' || LPAD(numbered.rn::text, 4, '0')
FROM numbered WHERE pattern_candidates.id = numbered.id;

-- ============================================================
-- 4. Advance sequences past backfilled values
-- ============================================================
SELECT setval('knowledge_short_id_seq',
  GREATEST((SELECT COUNT(*) FROM agent_knowledge_docs), 1));

SELECT setval('pattern_short_id_seq',
  GREATEST((SELECT COUNT(*) FROM pattern_candidates), 1));

-- ============================================================
-- 5. Add NOT NULL + UNIQUE constraints
-- ============================================================
ALTER TABLE agent_knowledge_docs ALTER COLUMN short_id SET NOT NULL;
ALTER TABLE agent_knowledge_docs ALTER COLUMN short_id SET DEFAULT 'K-' || LPAD(nextval('knowledge_short_id_seq')::text, 4, '0');
ALTER TABLE agent_knowledge_docs ADD CONSTRAINT agent_knowledge_docs_short_id_unique UNIQUE (short_id);

ALTER TABLE pattern_candidates ALTER COLUMN short_id SET NOT NULL;
ALTER TABLE pattern_candidates ALTER COLUMN short_id SET DEFAULT 'P-' || LPAD(nextval('pattern_short_id_seq')::text, 4, '0');
ALTER TABLE pattern_candidates ADD CONSTRAINT pattern_candidates_short_id_unique UNIQUE (short_id);
