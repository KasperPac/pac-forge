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
};

export const SECTION_LABELS: Record<string, string> = {
  identity: "Identity & Role",
  instructions: "Task Instructions",
  platform_rules: "Platform Rules",
  code_examples: "SCL Code Examples",
  reference_retrieval: "Reference Retrieval (Topic Extraction)",
};
