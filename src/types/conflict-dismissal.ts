export interface ConflictDismissal {
  id: string;
  fingerprint: string;
  source_a_type: string;
  source_a_label: string;
  source_a_excerpt: string;
  source_b_type: string;
  source_b_label: string;
  source_b_excerpt: string;
  reason: string;
  knowledge_doc_id: string | null;
  created_by: string | null;
  created_at: string;
}
