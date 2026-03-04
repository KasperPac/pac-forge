export interface PromptSection {
  id: string;
  role: string;
  section_key: string;
  content: string;
  version: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  notes: string | null;
}

export const PROMPT_ROLES = {
  SHARED: "shared",
  GENERATE: "generate",
  PROCESS: "process",
  REVIEW: "review",
  REWRITE: "rewrite",
  COMPILE_FIX: "compile_fix",
  PLAN: "plan",
  SUMMARY: "summary",
  PATTERNS: "patterns",
  FB_BUILDER: "fb_builder",
  PROCESS_QA: "process_qa",
  PROCESS_MATRIX_REVIEW: "process_matrix_review",
  PROCESS_IO: "process_io",
  PROCESS_FOLDERS: "process_folders",
  PROCESS_FB: "process_fb",
  PROCESS_DB: "process_db",
  PROCESS_FC: "process_fc",
  REVIEW_SCOPE_IO: "review_scope_io",
  REVIEW_SCOPE_FB: "review_scope_fb",
  REVIEW_SCOPE_DB: "review_scope_db",
  REVIEW_SCOPE_FC: "review_scope_fc",
} as const;

export type PromptRole = (typeof PROMPT_ROLES)[keyof typeof PROMPT_ROLES];

/** Human-readable labels for each role */
export const PROMPT_ROLE_LABELS: Record<PromptRole, string> = {
  shared: "Shared (Platform Rules & Examples)",
  generate: "Generate",
  process: "Process Code",
  review: "Review",
  rewrite: "Rewrite",
  compile_fix: "Compile Fix",
  plan: "Plan",
  summary: "Summary",
  patterns: "Pattern Analysis",
  fb_builder: "FB Builder",
  process_qa: "Process Q&A",
  process_matrix_review: "Process: Matrix Review",
  process_io: "Process: IO Stage",
  process_folders: "Process: Folder Stage",
  process_fb: "Process: FB Stage",
  process_db: "Process: DB Stage",
  process_fc: "Process: FC+OB Stage",
  review_scope_io: "Review: IO Stage Scope",
  review_scope_fb: "Review: FB Stage Scope",
  review_scope_db: "Review: DB Stage Scope",
  review_scope_fc: "Review: FC+OB Stage Scope",
};

/** Which section keys each role supports */
export const ROLE_SECTIONS: Record<PromptRole, string[]> = {
  shared: ["platform_rules", "code_examples", "reference_retrieval"],
  generate: ["identity", "instructions"],
  process: ["identity", "instructions"],
  review: ["identity", "instructions"],
  rewrite: ["identity", "instructions"],
  compile_fix: ["identity", "instructions"],
  plan: ["identity", "instructions"],
  summary: ["identity", "instructions"],
  patterns: ["identity", "instructions"],
  fb_builder: ["identity", "instructions"],
  process_qa: ["identity", "instructions"],
  process_matrix_review: ["instructions"],
  process_io: ["instructions"],
  process_folders: ["instructions"],
  process_fb: ["instructions"],
  process_db: ["instructions"],
  process_fc: ["instructions"],
  review_scope_io: ["scope"],
  review_scope_fb: ["scope"],
  review_scope_db: ["scope"],
  review_scope_fc: ["scope"],
};

export const SECTION_LABELS: Record<string, string> = {
  identity: "Identity & Role",
  instructions: "Task Instructions",
  platform_rules: "Platform Rules",
  code_examples: "SCL Code Examples",
  reference_retrieval: "Reference Retrieval (Topic Extraction)",
  scope: "Review Scope",
};
