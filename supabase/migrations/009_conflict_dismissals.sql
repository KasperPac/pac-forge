-- Conflict dismissals: tracks conflicts the user marked as "not a conflict"
-- with user reasoning that teaches the Pattern Librarian agent.
CREATE TABLE IF NOT EXISTS conflict_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deterministic fingerprint for re-detection suppression (hash of source excerpts)
  fingerprint text NOT NULL,
  source_a_type text NOT NULL,
  source_a_label text NOT NULL,
  source_a_excerpt text NOT NULL,
  source_b_type text NOT NULL,
  source_b_label text NOT NULL,
  source_b_excerpt text NOT NULL,
  reason text NOT NULL,
  -- Link to the Pattern Librarian knowledge doc created from this feedback
  knowledge_doc_id uuid REFERENCES agent_knowledge_docs(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Only one dismissal per conflict fingerprint
CREATE UNIQUE INDEX idx_conflict_dismissals_fingerprint
  ON conflict_dismissals (fingerprint);

-- Enable RLS
ALTER TABLE conflict_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read conflict dismissals"
  ON conflict_dismissals FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert conflict dismissals"
  ON conflict_dismissals FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete conflict dismissals"
  ON conflict_dismissals FOR DELETE
  TO authenticated
  USING (true);
