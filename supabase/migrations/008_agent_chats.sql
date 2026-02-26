-- Agent chat conversations (floating chat widget)
CREATE TABLE agent_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  agent_name text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own chats"
  ON agent_chats FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_agent_chats_user ON agent_chats(user_id);
CREATE INDEX idx_agent_chats_created ON agent_chats(created_at DESC);
