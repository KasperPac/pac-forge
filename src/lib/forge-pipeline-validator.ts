/**
 * forge-pipeline-validator.ts
 * 
 * Runtime validator that wraps AI calls to ensure each agent
 * is using the correct identity, context, and output format.
 * 
 * Usage: wrap callNonStreaming with validateAndCall() in forge hooks,
 * or call validatePipelineCall() before each AI call to log violations.
 * 
 * In development mode, violations are logged to console as warnings.
 * In production, violations are tracked silently (can be sent to audit log).
 */

// ---------------------------------------------------------------------------
// Agent identity markers — each agent MUST have at least one of these
// strings present in its system prompt
// ---------------------------------------------------------------------------

const AGENT_IDENTITY_MARKERS: Record<string, string[]> = {
  // Code generation agents
  code_architect_scl: [
    "senior Siemens TIA Portal SCL programmer",
    "SCL programmer generating",
    "Code Architect",
  ],
  code_architect_lad: [
    "LAD (Ladder Logic) programmer",
    "ladder rungs for",
    "LAD programmer",
  ],
  
  // Review agents
  standards_reviewer: [
    "Standards Reviewer",
    "Standards Enforcer",
    "review generated code",
    "standards violations",
    "code review",
  ],
  
  // Orchestration agents
  pm_plan: [
    "Project Manager",
    "plan the generation",
    "planning",
  ],
  pm_summary: [
    "Project Manager",
    "summarize",
    "summary",
  ],
  
  // Specialist agents
  pattern_librarian: [
    "Pattern Librarian",
    "correction analysis",
    "analyze the diff",
  ],
  io_validator: [
    "IO Validator",
    "validate IO",
    "IO mapping",
  ],
  safety_auditor: [
    "Safety Auditor",
    "safety check",
    "safety analysis",
  ],
  
  // Spec analysis
  spec_analysis: [
    "senior automation engineer",
    "analyzing a functional specification",
    "extract structured",
  ],

  // Q&A review (PM reviewing spec gaps with engineer)
  pm_qa: [
    "Project Manager",
    "reviewing",
    "spec analysis",
    "clarifying questions",
    "gaps",
    "senior automation engineer",
  ],
  
  // HMI agents
  hmi_generator: [
    "HMI",
    "WinCC",
    "screen",
    "faceplate",
  ],
  
  // Compile fix
  compile_fix: [
    "compile error",
    "fix the following",
    "compilation",
  ],
  
  // IO linking
  io_linking: [
    "IO linking",
    "IO wiring",
    "maps physical IO",
  ],
  
  // Process code (Code Architect role)
  process_scl: [
    "Code Architect",
    "process sequence",
    "state machine",
    "CASE-based",
    "sequence logic",
  ],
  process_lad: [
    "Code Architect",
    "process sequence",
    "sequential ladder",
    "sequence logic",
  ],
};

// ---------------------------------------------------------------------------
// Required context markers — these MUST appear in generation prompts
// ---------------------------------------------------------------------------

const REQUIRED_CONTEXT = {
  /** Platform rules must be in all code generation prompts */
  platform_rules: {
    markers: ["Platform Rules", "PLATFORM_RULES", "Siemens TIA Portal"],
    requiredFor: [
      "code_architect_scl",
      "code_architect_lad",
      "process_scl",
      "process_lad",
      "compile_fix",
      "io_linking",
    ],
  },
  /** Profile rules should be in generation prompts when a profile exists */
  profile_rules: {
    markers: ["Design Profile", "Code Design Profile"],
    requiredFor: [
      "code_architect_scl",
      "code_architect_lad",
      "process_scl",
      "process_lad",
    ],
    /** Not a hard failure — profile may not be set */
    softRequirement: true,
  },
  /** Correction patterns should be in all code generation prompts */
  correction_patterns: {
    markers: ["Learned Corrections", "MANDATORY: Learned", "correction"],
    requiredFor: [
      "code_architect_scl",
      "code_architect_lad",
      "process_scl",
      "process_lad",
      "compile_fix",
    ],
    softRequirement: true,
  },
};

// ---------------------------------------------------------------------------
// Output format expectations (documentation only — used in pipeline-auditor reports)
// ---------------------------------------------------------------------------

export const EXPECTED_OUTPUT_FORMATS: Record<string, string> = {
  code_architect_scl: "SCL fenced blocks with [BlockType:BlockName] markers",
  code_architect_lad: "LadProgram JSON object",
  standards_reviewer: "Structured review findings (NOT code)",
  pm_plan: "Planning text (NOT code)",
  pm_summary: "Summary text (NOT code)",
  pattern_librarian: "Correction analysis JSON",
  spec_analysis: "SpecAnalysis JSON matching schema",
  hmi_generator: "HmiScreenSpec JSON array",
  io_linking: "SCL fenced blocks for IO linking FC",
  process_scl: "SCL fenced blocks for process FC",
  process_lad: "LadProgram JSON for process sequence",
  compile_fix: "SCL fenced blocks with fixes",
};

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

export interface PipelineViolation {
  level: "error" | "warning";
  check: "identity" | "context" | "output_format" | "generic_prompt";
  agentType: string;
  message: string;
  promptPreview: string;
}

export interface PipelineValidationResult {
  valid: boolean;
  agentType: string | null;
  violations: PipelineViolation[];
}

// ---------------------------------------------------------------------------
// Core validation function
// ---------------------------------------------------------------------------

/**
 * Validate a pipeline call before it's made.
 * 
 * @param systemPrompt - The system prompt about to be sent
 * @param expectedAgent - Which agent type this call is supposed to be for
 * @param hasProfile - Whether a design profile is available
 * @returns Validation result with any violations found
 */
export function validatePipelineCall(
  systemPrompt: string,
  expectedAgent: string,
  hasProfile = false,
): PipelineValidationResult {
  const violations: PipelineViolation[] = [];
  const promptPreview = systemPrompt.slice(0, 200) + "…";

  // 1. Check agent identity
  const markers = AGENT_IDENTITY_MARKERS[expectedAgent];
  if (markers) {
    const hasIdentity = markers.some((marker) =>
      systemPrompt.toLowerCase().includes(marker.toLowerCase()),
    );
    if (!hasIdentity) {
      violations.push({
        level: "error",
        check: "identity",
        agentType: expectedAgent,
        message: `System prompt does not contain any identity markers for agent "${expectedAgent}". Expected one of: ${markers.join(", ")}`,
        promptPreview,
      });
    }
  }

  // 2. Check for generic prompt (red flag)
  const genericMarkers = [
    "you are a helpful assistant",
    "you are an ai assistant",
    "you are claude",
  ];
  const isGeneric = genericMarkers.some((m) =>
    systemPrompt.toLowerCase().includes(m),
  );
  if (isGeneric) {
    violations.push({
      level: "error",
      check: "generic_prompt",
      agentType: expectedAgent,
      message: `GENERIC PROMPT DETECTED — agent "${expectedAgent}" is using a generic AI identity instead of its specialized role.`,
      promptPreview,
    });
  }

  // 3. Check required context
  for (const [contextName, config] of Object.entries(REQUIRED_CONTEXT)) {
    if (!config.requiredFor.includes(expectedAgent)) continue;

    const hasContext = config.markers.some((marker) =>
      systemPrompt.includes(marker),
    );

    if (!hasContext) {
      // Skip soft requirements that aren't applicable
      if (contextName === "profile_rules" && !hasProfile) continue;
      if ("softRequirement" in config && config.softRequirement) {
        violations.push({
          level: "warning",
          check: "context",
          agentType: expectedAgent,
          message: `Missing recommended context "${contextName}" in prompt for agent "${expectedAgent}".`,
          promptPreview,
        });
      } else {
        violations.push({
          level: "error",
          check: "context",
          agentType: expectedAgent,
          message: `Missing REQUIRED context "${contextName}" in prompt for agent "${expectedAgent}".`,
          promptPreview,
        });
      }
    }
  }

  const hasErrors = violations.some((v) => v.level === "error");

  return {
    valid: !hasErrors,
    agentType: expectedAgent,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Logging / reporting
// ---------------------------------------------------------------------------

/**
 * Log pipeline violations to console (dev mode) or audit system.
 */
export function reportViolations(result: PipelineValidationResult): void {
  if (result.violations.length === 0) return;

  const errors = result.violations.filter((v) => v.level === "error");
  const warnings = result.violations.filter((v) => v.level === "warning");

  if (errors.length > 0) {
    console.error(
      `[Pipeline Validator] ❌ ${errors.length} ERROR(s) for agent "${result.agentType}":`,
    );
    for (const v of errors) {
      console.error(`  ❌ [${v.check}] ${v.message}`);
    }
  }

  if (warnings.length > 0) {
    console.warn(
      `[Pipeline Validator] ⚠️ ${warnings.length} warning(s) for agent "${result.agentType}":`,
    );
    for (const v of warnings) {
      console.warn(`  ⚠️ [${v.check}] ${v.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Validated call wrapper
// ---------------------------------------------------------------------------

// Matches callNonStreaming's MessageContent type from use-generation.ts (inlined to avoid cross-layer import)
type MessageContent = string | Array<
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
>;

// Match the actual callNonStreaming signature from use-generation.ts
type NonStreamingCallFn = (
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>,
  signal: AbortSignal,
  maxTokens?: number,
) => Promise<{ content: string; usage: { input: number; output: number } | null }>;

/**
 * Wraps callNonStreaming with pipeline validation.
 * Use this instead of calling callNonStreaming directly in forge hooks.
 *
 * @param callFn - The actual callNonStreaming function
 * @param systemPrompt - System prompt to validate and send
 * @param messages - Messages to send
 * @param signal - Abort signal
 * @param maxTokens - Max tokens
 * @param expectedAgent - Which agent type this should be
 * @param hasProfile - Whether a design profile is active
 * @returns The AI response (same as callNonStreaming)
 * @throws If validation finds critical errors (in development mode)
 */
export async function validateAndCall(
  callFn: NonStreamingCallFn,
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>,
  signal: AbortSignal,
  maxTokens: number | undefined,
  expectedAgent: string,
  hasProfile = false,
): Promise<{ content: string; usage: { input: number; output: number } | null }> {
  const result = validatePipelineCall(systemPrompt, expectedAgent, hasProfile);
  reportViolations(result);

  if (!result.valid && import.meta.env.DEV) {
    const errorMessages = result.violations
      .filter((v) => v.level === "error")
      .map((v) => v.message)
      .join("\n");
    console.error(
      `[Pipeline Validator] Blocking call to "${expectedAgent}" due to validation errors:\n${errorMessages}`,
    );
    // In dev mode, throw to catch issues early
    // In production, log but allow the call (to avoid breaking the app)
    throw new Error(
      `Pipeline validation failed for agent "${expectedAgent}": ${errorMessages}`,
    );
  }

  return callFn(systemPrompt, messages, signal, maxTokens);
}

// ---------------------------------------------------------------------------
// Full pipeline audit (run manually or from a test)
// ---------------------------------------------------------------------------

/**
 * Audit a complete forge pipeline execution.
 * Call this after a full wizard run to verify all steps used correct agents.
 * 
 * @param pipelineLog - Array of { agentType, systemPrompt, response } entries
 * @returns Summary of all violations across the pipeline
 */
export function auditFullPipeline(
  pipelineLog: Array<{
    agentType: string;
    systemPrompt: string;
    hasProfile: boolean;
  }>,
): {
  passed: boolean;
  totalErrors: number;
  totalWarnings: number;
  results: PipelineValidationResult[];
} {
  const results = pipelineLog.map((entry) =>
    validatePipelineCall(entry.systemPrompt, entry.agentType, entry.hasProfile),
  );

  const totalErrors = results.reduce(
    (sum, r) => sum + r.violations.filter((v) => v.level === "error").length,
    0,
  );
  const totalWarnings = results.reduce(
    (sum, r) => sum + r.violations.filter((v) => v.level === "warning").length,
    0,
  );

  return {
    passed: totalErrors === 0,
    totalErrors,
    totalWarnings,
    results,
  };
}
