export interface AgentKnowledgeDoc {
  id: string;
  short_id: string;
  agent_id: string;
  title: string;
  content: string;
  source_filename: string | null;
  file_type: string;
  word_count: number;
  source_upload_id: string | null;
  distribution_reasoning: string | null;
  plc_brand: string;
  compatible_cpus: string[];
  created_by: string | null;
  created_at: string;
}

export type AgentKnowledgeDocCreate = Omit<
  AgentKnowledgeDoc,
  "id" | "short_id" | "created_at" | "created_by" | "source_upload_id" | "distribution_reasoning"
> & {
  source_upload_id?: string | null;
  distribution_reasoning?: string | null;
};

export interface KnowledgeUpload {
  id: string;
  source_filename: string;
  file_type: string;
  word_count: number;
  full_content: string;
  distribution: KnowledgeDistributionEntry[];
  plc_brand: string;
  compatible_cpus: string[];
  created_by: string | null;
  created_at: string;
}

export interface KnowledgeDistributionEntry {
  agent_id: string;
  agent_name: string;
  doc_id: string;
  title: string;
  reasoning: string;
  /** First ~300 chars of the distributed content (for display in upload history). */
  content_preview?: string;
}

export interface KnowledgeUploadCreate {
  source_filename: string;
  file_type: string;
  word_count: number;
  full_content: string;
  plc_brand: string;
  compatible_cpus: string[];
}
