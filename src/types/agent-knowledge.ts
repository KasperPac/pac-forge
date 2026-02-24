export interface AgentKnowledgeDoc {
  id: string;
  agent_id: string;
  title: string;
  content: string;
  source_filename: string | null;
  file_type: string;
  word_count: number;
  created_by: string | null;
  created_at: string;
}

export type AgentKnowledgeDocCreate = Omit<
  AgentKnowledgeDoc,
  "id" | "created_at" | "created_by"
>;
