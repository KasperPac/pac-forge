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
  // Project Manager
  FORGE_PM_SPEC_ANALYSIS: "forge_pm_spec_analysis",
  FORGE_PM_QA_REVIEW: "forge_pm_qa_review",
  FORGE_PM_DEVICE_LINKAGE: "forge_pm_device_linkage",
  FORGE_PM_SEQUENCES: "forge_pm_sequences",
  // Code Architect
  FORGE_ARCH_DEVICE: "forge_arch_device",
  FORGE_ARCH_CALL_FC: "forge_arch_call_fc",
  FORGE_ARCH_IO_LINKING: "forge_arch_io_linking",
  FORGE_ARCH_PROCESS: "forge_arch_process",
  FORGE_ARCH_REWRITE: "forge_arch_rewrite",
  FORGE_ARCH_COMPILE_FIX: "forge_arch_compile_fix",
  // Standards Reviewer
  FORGE_REVIEWER: "forge_reviewer",
  REVIEW_SCOPE_IO: "review_scope_io",
  REVIEW_SCOPE_FB: "review_scope_fb",
  REVIEW_SCOPE_DB: "review_scope_db",
  REVIEW_SCOPE_FC: "review_scope_fc",
  // IO Validator
  FORGE_IO_VALIDATOR: "forge_io_validator",
  // Pattern Librarian
  FORGE_PATTERN_LIBRARIAN: "forge_pattern_librarian",
  // Safety Auditor
  FORGE_SAFETY_AUDITOR: "forge_safety_auditor",
  // HMI Agent
  HMI_DESIGNER: "hmi_designer",
  HMI_SVG_GENERATOR: "hmi_svg_generator",
} as const;

export type PromptRole = (typeof PROMPT_ROLES)[keyof typeof PROMPT_ROLES];

/** Human-readable labels for each role */
export const PROMPT_ROLE_LABELS: Record<PromptRole, string> = {
  shared: "Shared (Platform Rules & Examples)",
  // Project Manager
  forge_pm_spec_analysis: "Spec Analysis",
  forge_pm_qa_review: "Q&A Review",
  forge_pm_device_linkage: "Matrix: Device Linkage",
  forge_pm_sequences: "Matrix: Process Sequences",
  // Code Architect
  forge_arch_device: "Device FB Generation",
  forge_arch_call_fc: "Device Call FC",
  forge_arch_io_linking: "IO Linking FC",
  forge_arch_process: "Process Code",
  forge_arch_rewrite: "Rewrite from Review",
  forge_arch_compile_fix: "Compile Fix",
  // Standards Reviewer
  forge_reviewer: "Code Review",
  review_scope_io: "Review: IO Stage Scope",
  review_scope_fb: "Review: FB Stage Scope",
  review_scope_db: "Review: DB Stage Scope",
  review_scope_fc: "Review: FC+OB Stage Scope",
  // IO Validator
  forge_io_validator: "IO Validation",
  // Pattern Librarian
  forge_pattern_librarian: "Pattern Analysis",
  // Safety Auditor
  forge_safety_auditor: "Safety Audit",
  // HMI Agent
  hmi_designer: "HMI Screen Designer",
  hmi_svg_generator: "HMI SVG Generator",
};

/** Which section keys each role supports */
export const ROLE_SECTIONS: Record<PromptRole, string[]> = {
  shared: ["platform_rules", "code_examples", "reference_retrieval"],
  // Project Manager
  forge_pm_spec_analysis: ["identity", "instructions"],
  forge_pm_qa_review: ["identity", "instructions"],
  forge_pm_device_linkage: ["identity", "instructions"],
  forge_pm_sequences: ["identity", "instructions"],
  // Code Architect
  forge_arch_device: ["identity", "instructions"],
  forge_arch_call_fc: ["identity", "instructions"],
  forge_arch_io_linking: ["identity", "instructions"],
  forge_arch_process: ["identity", "instructions"],
  forge_arch_rewrite: ["identity", "instructions"],
  forge_arch_compile_fix: ["identity", "instructions"],
  // Standards Reviewer
  forge_reviewer: ["identity", "instructions"],
  review_scope_io: ["scope"],
  review_scope_fb: ["scope"],
  review_scope_db: ["scope"],
  review_scope_fc: ["scope"],
  // IO Validator
  forge_io_validator: ["identity", "instructions"],
  // Pattern Librarian
  forge_pattern_librarian: ["identity", "instructions"],
  // Safety Auditor
  forge_safety_auditor: ["identity", "instructions"],
  // HMI Agent
  hmi_designer: ["identity", "instructions"],
  hmi_svg_generator: ["identity", "instructions"],
};

export const SECTION_LABELS: Record<string, string> = {
  identity: "Identity & Role",
  instructions: "Task Instructions",
  platform_rules: "Platform Rules",
  code_examples: "SCL Code Examples",
  reference_retrieval: "Reference Retrieval (Topic Extraction)",
  scope: "Review Scope",
};
