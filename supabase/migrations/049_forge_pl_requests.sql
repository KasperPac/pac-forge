CREATE TABLE forge_pl_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  session_id text NOT NULL,
  artifact_type text NOT NULL,
  pipeline_step text NOT NULL,
  round_index integer NOT NULL DEFAULT 0,
  function_name text NOT NULL,
  call_role text NOT NULL CHECK (call_role IN ('primary', 'supporting')),
  pl_request_id bigint NOT NULL,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT uq_forge_pl_request
    UNIQUE (session_id, artifact_type, pipeline_step, round_index)
);

CREATE INDEX idx_forge_pl_user_id ON forge_pl_requests (user_id);
CREATE INDEX idx_forge_pl_lookup
  ON forge_pl_requests (session_id, artifact_type, pipeline_step, round_index);
CREATE INDEX idx_forge_pl_primary
  ON forge_pl_requests (session_id, call_role);

ALTER TABLE forge_pl_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "forge_pl_requests_select_own" ON forge_pl_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "forge_pl_requests_insert_own" ON forge_pl_requests
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "forge_pl_requests_update_own" ON forge_pl_requests
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "forge_pl_requests_delete_own" ON forge_pl_requests
  FOR DELETE TO authenticated USING (user_id = auth.uid());
