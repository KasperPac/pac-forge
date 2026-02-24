-- Agent Knowledge Base: per-agent document storage for specialization
CREATE TABLE agent_knowledge_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  source_filename text,
  file_type text NOT NULL DEFAULT 'md',
  word_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_knowledge_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "knowledge_docs_select" ON agent_knowledge_docs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "knowledge_docs_insert" ON agent_knowledge_docs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "knowledge_docs_update" ON agent_knowledge_docs
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "knowledge_docs_delete" ON agent_knowledge_docs
  FOR DELETE TO authenticated USING (true);

-- Seed the Project Manager agent
INSERT INTO agents (display_name, specialties, system_prompt) VALUES (
  'Project Manager',
  ARRAY['ORCHESTRATE'],
  'You are the Project Manager for the Pac-ST agent pipeline. Your role is to coordinate the team of specialized agents. In the planning phase, you analyze the user request, identify which agents should be engaged, and outline a brief execution plan. In the summary phase, you synthesize results from all agents, flag any disagreements between reviewers, and provide a clear final status report. You never modify code directly — your job is orchestration and communication.'
);
