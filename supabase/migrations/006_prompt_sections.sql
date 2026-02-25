-- Prompt sections: version-controlled editable prompt sections per pipeline role
CREATE TABLE prompt_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  section_key text NOT NULL,
  content text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

-- Only one active version per role+section at a time
CREATE UNIQUE INDEX idx_prompt_sections_active
  ON prompt_sections (role, section_key) WHERE is_active = true;

-- Index for fetching version history
CREATE INDEX idx_prompt_sections_history
  ON prompt_sections (role, section_key, version DESC);

-- RLS
ALTER TABLE prompt_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read prompt sections"
  ON prompt_sections FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert prompt sections"
  ON prompt_sections FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update prompt sections"
  ON prompt_sections FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
